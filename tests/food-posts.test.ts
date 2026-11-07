import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { seedId } from "../prisma/demo-data";

// Community food posts (migration 0013) against real PostgreSQL with the
// test auth + storage stand-ins. Every test rolls back.
const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Food post tests require a *_test DATABASE_URL.");
const CAMPUS = seedId(1);
type Db = pg.Client;

async function transaction(check: (db: Db) => Promise<void>) {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("BEGIN");
    await check(db);
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
}
async function owner(db: Db) {
  await db.query("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claims', '', true)");
}
async function as(db: Db, subject: string) {
  await owner(db);
  await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: subject, role: "authenticated" }),
  ]);
  await db.query("SET LOCAL ROLE authenticated");
}
async function rpc(db: Db, fn: string, args: unknown[] = []) {
  const params = args.map((_, i) => `$${i + 1}`).join(", ");
  const r = await db.query(`SELECT public.${fn}(${params}) AS r`, args);
  return r.rows[0].r;
}
async function rejects(db: Db, run: () => Promise<unknown>, message: string) {
  await db.query("SAVEPOINT expected_failure");
  await assert.rejects(run(), { message });
  await db.query("ROLLBACK TO SAVEPOINT expected_failure");
}
/** Confirmed, campus-verified student with one uploaded photo. */
async function student(
  db: Db,
  name: string,
  slug = "demo-campus",
  domain = "students.example.invalid",
) {
  await owner(db);
  const subject = randomUUID();
  await db.query(
    "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, now())",
    [subject, `u-${subject.slice(0, 8)}@${domain}`],
  );
  await as(db, subject);
  await rpc(db, "upsert_profile", [name]);
  const s = await rpc(db, "verify_campus_membership", [slug]);
  await owner(db);
  const photo = `${subject}/${randomUUID()}.jpg`;
  await db.query(
    "INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('listing-photos', $1, $2)",
    [photo, subject],
  );
  return { subject, member: s.memberships[0].membership_id as string, photo };
}
const hours = (n: number) => new Date(Date.now() + n * 3600_000).toISOString();
function meal(photo: string, extra: Record<string, unknown> = {}) {
  return {
    kind: "meal",
    title: "Vegetable curry",
    description:
      "Made a big pot tonight, happy to share with anyone who wants dinner.",
    photos: [photo],
    servings: 4,
    prepared_at: hours(-1),
    available_from: hours(-0.5),
    available_until: hours(3),
    pickup_place: "Buchanan Towers lobby",
    pickup_instructions: "Bring a container if you can.",
    ingredients: "Chickpeas, potatoes, coconut milk, spices",
    allergens: [],
    allergens_known: false,
    handling: "Keep refrigerated; reheat until hot.",
    ...extra,
  };
}
async function save(
  db: Db,
  who: { subject: string },
  id: string,
  payload: unknown,
  updated: string | null = null,
) {
  await as(db, who.subject);
  const r = await rpc(db, "save_food_post", [
    CAMPUS,
    id,
    payload,
    randomUUID(),
    updated,
  ]);
  return r.data;
}

test("a verified student can publish, edit and close a meal post", async () => {
  await transaction(async (db) => {
    const cook = await student(db, "Rowan");
    const id = randomUUID();
    const post = await save(db, cook, id, meal(cook.photo));
    assert.equal(post.state, "available");
    assert.equal(post.is_owner, true);
    assert.equal(post.author_name, "Rowan");
    assert.doesNotMatch(JSON.stringify(post), /@students|email/);

    const edited = await save(
      db,
      cook,
      id,
      meal(cook.photo, { servings: 2 }),
      post.updated_at,
    );
    assert.equal(edited.servings, 2);
    // A stale edit is refused instead of overwriting newer changes.
    await rejects(
      db,
      () =>
        rpc(db, "save_food_post", [
          CAMPUS,
          id,
          meal(cook.photo),
          randomUUID(),
          post.updated_at,
        ]),
      "INVALID_STATE",
    );

    const closed = await rpc(db, "close_food_post", [id, false]);
    assert.equal(closed.state, "closed");
    assert.deepEqual(await rpc(db, "food_posts", [CAMPUS, "", false]), []);
    const mine = await rpc(db, "food_posts", [CAMPUS, "", true]);
    assert.equal(mine[0].state, "closed");
  });
});

test("other students discover current posts and can message the cook", async () => {
  await transaction(async (db) => {
    const cook = await student(db, "Rowan");
    const friend = await student(db, "Sam");
    const id = randomUUID();
    await save(db, cook, id, meal(cook.photo));
    await save(db, cook, randomUUID(), {
      ...meal(cook.photo),
      kind: "event",
      title: "Free pizza after club meeting",
      servings: null,
      prepared_at: null,
      available_from: hours(1),
      available_until: hours(3),
    });

    await as(db, friend.subject);
    const all = await rpc(db, "food_posts", [CAMPUS, "", false]);
    assert.deepEqual(
      all.map((p: { kind: string; state: string }) => [p.kind, p.state]),
      [
        ["meal", "available"],
        ["event", "upcoming"],
      ],
    );
    assert.equal(
      (await rpc(db, "food_posts", [CAMPUS, "event", false])).length,
      1,
    );
    assert.equal(all[0].is_owner, false);
    // The cook's photo is readable by a verified member while the post is open.
    const photo = await db.query(
      "SELECT name FROM storage.objects WHERE name = $1",
      [cook.photo],
    );
    assert.equal(photo.rowCount, 1);

    const started = await rpc(db, "start_food_conversation", [id]);
    await rpc(db, "send_message", [
      started.conversation_id,
      "Could I pick up one serving?",
    ]);
    const again = await rpc(db, "start_food_conversation", [id]);
    assert.equal(again.conversation_id, started.conversation_id);

    await as(db, cook.subject);
    const inbox = await rpc(db, "my_conversations");
    assert.equal(inbox[0].subject, "food");
    assert.equal(inbox[0].listing_title, "Vegetable curry");
    assert.equal(inbox[0].last_message, "Could I pick up one serving?");
    const thread = await rpc(db, "conversation_messages", [
      started.conversation_id,
    ]);
    assert.equal(thread.food_post_id, id);
    await rejects(
      db,
      () => rpc(db, "start_food_conversation", [id]),
      "VALIDATION_ERROR",
    );
  });
});

test("expired, closed and foreign posts are unavailable", async () => {
  await transaction(async (db) => {
    const cook = await student(db, "Rowan");
    const friend = await student(db, "Sam");
    const id = randomUUID();
    await save(db, cook, id, meal(cook.photo));
    // Simulate time passing past the pickup window.
    await owner(db);
    await db.query(
      `UPDATE "FoodPost" SET "availableUntil" = now() - interval '1 minute', "availableFrom" = now() - interval '2 hours' WHERE id = $1`,
      [id],
    );
    await as(db, friend.subject);
    assert.deepEqual(await rpc(db, "food_posts", [CAMPUS, "", false]), []);
    assert.equal((await rpc(db, "food_post", [id])).state, "expired");
    await rejects(
      db,
      () => rpc(db, "start_food_conversation", [id]),
      "INVALID_STATE",
    );

    // Another campus cannot see or message it.
    await owner(db);
    const campus = randomUUID();
    const slug = `other-${campus.slice(0, 8)}`;
    await db.query(
      `INSERT INTO "Campus" (id, slug, name, "emailDomains", "isDemo") VALUES ($1, $2, 'Other demo campus', ARRAY['other.example.invalid'], true)`,
      [campus, slug],
    );
    const outsider = await student(db, "Kai", slug, "other.example.invalid");
    await as(db, outsider.subject);
    await rejects(db, () => rpc(db, "food_post", [id]), "NOT_FOUND");
    await rejects(
      db,
      () => rpc(db, "food_posts", [CAMPUS, "", false]),
      "FORBIDDEN",
    );
    const photo = await db.query(
      "SELECT name FROM storage.objects WHERE name = $1",
      [cook.photo],
    );
    assert.equal(photo.rowCount, 0);
  });
});

test("inputs, ownership and contact details are enforced server-side", async () => {
  await transaction(async (db) => {
    const cook = await student(db, "Rowan");
    const other = await student(db, "Sam");
    const id = randomUUID();
    const bad = async (payload: unknown) => {
      await as(db, cook.subject);
      await rejects(
        db,
        () =>
          rpc(db, "save_food_post", [
            CAMPUS,
            randomUUID(),
            payload,
            randomUUID(),
            null,
          ]),
        "VALIDATION_ERROR",
      );
    };
    await bad(meal(cook.photo, { photos: [] }));
    await bad(meal(other.photo)); // someone else's upload
    await bad(
      meal(cook.photo, {
        description: "Text me at 360-555-0123 for pickup please",
      }),
    );
    await bad(
      meal(cook.photo, { pickup_instructions: "email rowan@example.com" }),
    );
    await bad(meal(cook.photo, { prepared_at: hours(-72) }));
    await bad(meal(cook.photo, { available_until: hours(-1) }));
    await bad(meal(cook.photo, { available_until: hours(30) }));
    await bad(
      meal(cook.photo, { allergens: ["peanuts"], allergens_known: false }),
    );
    await bad(meal(cook.photo, { servings: null }));
    // A date in the text is not mistaken for a phone number.
    await save(
      db,
      cook,
      id,
      meal(cook.photo, {
        description: "Cooked on 2026-11-08 for the study group, plenty left.",
      }),
    );

    // Only the author can edit or close; others see NOT_FOUND.
    await as(db, other.subject);
    const post = await rpc(db, "food_post", [id]);
    await rejects(
      db,
      () =>
        rpc(db, "save_food_post", [
          CAMPUS,
          id,
          meal(other.photo),
          randomUUID(),
          post.updated_at,
        ]),
      "NOT_FOUND",
    );
    await rejects(
      db,
      () => rpc(db, "close_food_post", [id, false]),
      "NOT_FOUND",
    );
    await rejects(
      db,
      () => rpc(db, "close_food_post", [id, true]),
      "FORBIDDEN",
    );
    // No direct table access from the browser role.
    await rejects(
      db,
      () => db.query('SELECT 1 FROM "FoodPost"'),
      "permission denied for table FoodPost",
    );
  });
});

test("a campus admin can remove a post, and unauthenticated calls fail", async () => {
  await transaction(async (db) => {
    const cook = await student(db, "Rowan");
    const admin = await student(db, "Admin");
    await owner(db);
    await db.query(`UPDATE "Membership" SET role = 'ADMIN' WHERE id = $1`, [
      admin.member,
    ]);
    const id = randomUUID();
    await save(db, cook, id, meal(cook.photo));
    await as(db, admin.subject);
    assert.equal(
      (await rpc(db, "close_food_post", [id, true])).status,
      "removed",
    );
    await as(db, cook.subject);
    assert.equal((await rpc(db, "food_post", [id])).state, "removed");
    await owner(db);
    await db.query("SET LOCAL ROLE authenticated");
    await rejects(
      db,
      () => rpc(db, "food_posts", [CAMPUS, "", false]),
      "UNAUTHENTICATED",
    );
    await owner(db);
    await db.query("SET LOCAL ROLE anon");
    await rejects(
      db,
      () => rpc(db, "food_posts", [CAMPUS, "", false]),
      "permission denied for function food_posts",
    );
  });
});

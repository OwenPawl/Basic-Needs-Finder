import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { seedId } from "../prisma/demo-data";

// messaging-core checks against real PostgreSQL, using the same role switching
// as Supabase's Data API. Each test runs in a rolled-back transaction.
const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Messaging tests require DATABASE_URL pointing to a *_test database. Run db:test-auth-shim, migrations and seed first.",
  );
const DEMO_CAMPUS = seedId(1);
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
async function asOwner(db: Db) {
  await db.query("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claims', '', true)");
}
async function as(db: Db, subject: string) {
  await asOwner(db);
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
/** A confirmed, campus-verified student; returns auth subject and membership. */
async function student(
  db: Db,
  name: string,
  domain = "students.example.invalid",
  slug = "demo-campus",
) {
  await asOwner(db);
  const subject = randomUUID();
  await db.query(
    "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, now())",
    [subject, `u-${subject.slice(0, 8)}@${domain}`],
  );
  await as(db, subject);
  await rpc(db, "upsert_profile", [name]);
  const s = await rpc(db, "verify_campus_membership", [slug]);
  await asOwner(db);
  return { subject, member: s.memberships[0].membership_id as string };
}
async function listingBy(db: Db, author: string, campus = DEMO_CAMPUS) {
  await asOwner(db);
  const id = randomUUID();
  const { rows } = await db.query(
    `SELECT id FROM "Location" WHERE "campusId" = $1 LIMIT 1`,
    [campus],
  );
  await db.query(
    `INSERT INTO "Listing" (id, "campusId", "authorId", "categoryId", "locationId", title, description, kind, images, "updatedAt")
     VALUES ($1, $2, $3, 'other', $4, 'Desk lamp', 'Fictional test listing', 'OFFER', '{}', now())`,
    [id, campus, author, rows[0].id],
  );
  return id;
}

test("two verified students can start and continue a listing conversation", async () => {
  await transaction(async (db) => {
    const author = await student(db, "Rowan");
    const asker = await student(db, "Sam");
    const listing = await listingBy(db, author.member);

    await as(db, asker.subject);
    const started = await rpc(db, "start_conversation", [listing]);
    assert.equal(started.created, true);
    const again = await rpc(db, "start_conversation", [listing]);
    assert.deepEqual(
      [again.conversation_id, again.created],
      [started.conversation_id, false],
    );
    await rpc(db, "send_message", [
      started.conversation_id,
      "  Is the lamp still available?  ",
    ]);

    await as(db, author.subject);
    await rpc(db, "send_message", [
      started.conversation_id,
      "Yes, at the desk.",
    ]);
    const thread = await rpc(db, "conversation_messages", [
      started.conversation_id,
    ]);
    assert.deepEqual(
      thread.messages.map(
        (m: { body: string; mine: boolean; sender_name: string }) => [
          m.body,
          m.mine,
          m.sender_name,
        ],
      ),
      [
        ["Is the lamp still available?", false, "Sam"],
        ["Yes, at the desk.", true, "Rowan"],
      ],
    );
    const inbox = await rpc(db, "my_conversations");
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].other_display_name, "Sam");
    assert.equal(inbox[0].last_message, "Yes, at the desk.");
    assert.doesNotMatch(JSON.stringify([thread, inbox]), /@|email/);
  });
});

test("outsiders cannot read, send to, or discover a conversation", async () => {
  await transaction(async (db) => {
    const author = await student(db, "Rowan");
    const asker = await student(db, "Sam");
    const outsider = await student(db, "Jules");
    const listing = await listingBy(db, author.member);
    await as(db, asker.subject);
    const { conversation_id } = await rpc(db, "start_conversation", [listing]);
    await rpc(db, "send_message", [conversation_id, "Private question"]);

    await as(db, outsider.subject);
    await rejects(
      db,
      () => rpc(db, "conversation_messages", [conversation_id]),
      "NOT_FOUND",
    );
    await rejects(
      db,
      () => rpc(db, "send_message", [conversation_id, "hi"]),
      "NOT_FOUND",
    );
    assert.deepEqual(await rpc(db, "my_conversations"), []);
    const direct = await db.query(
      'SELECT count(*)::int AS n FROM "Message" WHERE "conversationId" = $1',
      [conversation_id],
    );
    assert.equal(direct.rows[0].n, 0);
    await rejects(
      db,
      () =>
        db.query(
          'INSERT INTO "Message" (id, "conversationId", "senderId", body) VALUES ($1, $2, $3, $4)',
          [randomUUID(), conversation_id, outsider.member, "x"],
        ),
      "permission denied for table Message",
    );
  });
});

test("messages are validated and own or foreign-campus listings are refused", async () => {
  await transaction(async (db) => {
    const author = await student(db, "Rowan");
    const asker = await student(db, "Sam");
    const listing = await listingBy(db, author.member);
    await as(db, author.subject);
    await rejects(
      db,
      () => rpc(db, "start_conversation", [listing]),
      "VALIDATION_ERROR",
    );

    await as(db, asker.subject);
    const { conversation_id } = await rpc(db, "start_conversation", [listing]);
    await rejects(
      db,
      () => rpc(db, "send_message", [conversation_id, "   "]),
      "VALIDATION_ERROR",
    );
    await rejects(
      db,
      () => rpc(db, "send_message", [conversation_id, "x".repeat(2001)]),
      "VALIDATION_ERROR",
    );
    await rejects(
      db,
      () => rpc(db, "start_conversation", [randomUUID()]),
      "NOT_FOUND",
    );

    // A listing on another campus is indistinguishable from a missing one.
    await asOwner(db);
    const campus = randomUUID();
    await db.query(
      `INSERT INTO "Campus" (id, slug, name, "emailDomains", "isDemo") VALUES ($1, $2, 'Other demo campus', ARRAY['other.example.invalid'], true)`,
      [campus, `other-${campus.slice(0, 8)}`],
    );
    await db.query(
      `INSERT INTO "Location" (id, "campusId", name, building, hours, instructions) VALUES ($1, $2, 'Desk', 'X', 'X', 'X')`,
      [randomUUID(), campus],
    );
    const other = await student(
      db,
      "Kai",
      "other.example.invalid",
      `other-${campus.slice(0, 8)}`,
    );
    const foreign = await listingBy(db, other.member, campus);
    await as(db, asker.subject);
    await rejects(
      db,
      () => rpc(db, "start_conversation", [foreign]),
      "NOT_FOUND",
    );
  });
});

test("unauthenticated and anonymous callers are rejected", async () => {
  await transaction(async (db) => {
    await asOwner(db);
    await db.query("SET LOCAL ROLE authenticated");
    await rejects(db, () => rpc(db, "my_conversations"), "UNAUTHENTICATED");
    await asOwner(db);
    await db.query("SET LOCAL ROLE anon");
    await rejects(
      db,
      () => rpc(db, "my_conversations"),
      "permission denied for function my_conversations",
    );
  });
});

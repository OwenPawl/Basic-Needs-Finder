import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Exchange tests require a dedicated *_test database.");
async function fixture(
  fn: (db: pg.Client, f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query("BEGIN");
  try {
    await fn(db, await setup(db));
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
}
async function as(db: pg.Client, subject: string | null) {
  await db.query("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
    subject ?? "",
  ]);
  await db.query("SET LOCAL ROLE authenticated");
}
async function setup(db: pg.Client) {
  const campus = randomUUID(),
    location = randomUUID(),
    otherCampus = randomUUID(),
    otherLocation = randomUUID();
  for (const [id, loc] of [
    [campus, location],
    [otherCampus, otherLocation],
  ]) {
    await db.query(
      'INSERT INTO "Campus"(id,slug,name,"emailDomains","isDemo")VALUES($1,$2,\'Test campus\',$3,true)',
      [id, id, ["students.example.invalid"]],
    );
    await db.query(
      "INSERT INTO \"Location\"(id,\"campusId\",name,building,hours,instructions)VALUES($1,$2,'Test collection desk','Test building','Test hours','Test instructions')",
      [loc, id],
    );
  }
  async function member(campusId: string, verified = true) {
    const subject = randomUUID(),
      user = randomUUID(),
      membership = randomUUID(),
      photo = subject + "/" + randomUUID() + ".jpg";
    await db.query(
      "INSERT INTO auth.users(id,email,email_confirmed_at)VALUES($1,$2,now())",
      [subject, subject + "@students.example.invalid"],
    );
    await db.query(
      'INSERT INTO "User"(id,"authSubject",email,"displayName")VALUES($1,$2,$3,\'Test student\')',
      [user, subject, subject + "@students.example.invalid"],
    );
    await db.query(
      'INSERT INTO "Membership"(id,"campusId","userId","verifiedAt")VALUES($1,$2,$3,$4)',
      [membership, campusId, user, verified ? new Date() : null],
    );
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name,owner_id)VALUES('listing-photos',$1,$2)",
      [photo, subject],
    );
    return { subject, user, membership, photo };
  }
  return {
    campus,
    location,
    otherCampus,
    otherLocation,
    alice: await member(campus),
    bob: await member(campus),
    outsider: await member(otherCampus),
    unverified: await member(campus, false),
  };
}
function input(
  f: Awaited<ReturnType<typeof setup>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    kind: "offer",
    title: "Winter jacket",
    description: "Clean winter jacket in good condition.",
    category_id: "clothing",
    location_id: f.location,
    quantity: 3,
    images: [f.alice.photo],
    food: null,
    ...overrides,
  };
}
async function save(
  db: pg.Client,
  campus: string,
  id: string,
  payload: unknown,
  key = randomUUID(),
  updated: string | null = null,
) {
  const r = await db.query(
    "SELECT public.save_exchange_listing($1,$2,$3::jsonb,$4,$5) AS result",
    [campus, id, JSON.stringify(payload), key, updated],
  );
  return r.rows[0].result;
}
async function rejected(
  db: pg.Client,
  fn: () => Promise<unknown>,
  message: string,
) {
  await db.query("SAVEPOINT expected_rejection");
  try {
    await assert.rejects(fn, (e: any) => e.message === message);
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT expected_rejection");
  }
}
test("goods offer creates exactly one unavailable pledge and retry is idempotent", async () =>
  fixture(async (db, f) => {
    await as(db, f.alice.subject);
    const id = randomUUID(),
      key = randomUUID();
    const first = await save(db, f.campus, id, input(f), key);
    const retry = await save(db, f.campus, id, input(f), key);
    assert.equal(first.data.kind, "offer");
    assert.equal(first.data.lots.length, 1);
    assert.equal(first.data.lots[0].status, "pledged");
    assert.equal(first.data.lots[0].available, 0);
    assert.equal(first.data.lots[0].on_hand, 0);
    assert.equal(retry.data.id, id);
    assert.equal(retry.replayed, true);
    const conflict = await save(
      db,
      f.campus,
      id,
      input(f, { quantity: 4 }),
      key,
    );
    assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
    await db.query("RESET ROLE");
    const count = await db.query(
      'SELECT count(*)::int AS n FROM "StockLot" WHERE "listingId"=$1',
      [id],
    );
    assert.equal(count.rows[0].n, 1);
  }));
test("request persists without stock or a required photo", async () =>
  fixture(async (db, f) => {
    await as(db, f.alice.subject);
    const r = await save(
      db,
      f.campus,
      randomUUID(),
      input(f, { kind: "request", images: [], quantity: null }),
    );
    assert.equal(r.data.kind, "request");
    assert.equal(r.data.lots.length, 0);
  }));
test("owner can edit a pending offer; other users and stale versions cannot", async () =>
  fixture(async (db, f) => {
    await as(db, f.alice.subject);
    const id = randomUUID();
    const first = await save(db, f.campus, id, input(f));
    const second = await save(
      db,
      f.campus,
      id,
      input(f, { quantity: 2 }),
      randomUUID(),
      first.data.updated_at,
    );
    assert.equal(second.data.lots[0].pledged_quantity, 2);
    await rejected(
      db,
      () =>
        save(db, f.campus, id, input(f), randomUUID(), first.data.updated_at),
      "INVALID_STATE",
    );
    await as(db, f.bob.subject);
    await rejected(
      db,
      () =>
        save(
          db,
          f.campus,
          id,
          input(f, { images: [f.bob.photo] }),
          randomUUID(),
          second.data.updated_at,
        ),
      "NOT_FOUND",
    );
  }));
test("received stock cannot be edited through listing writes", async () =>
  fixture(async (db, f) => {
    await as(db, f.alice.subject);
    const id = randomUUID();
    const r = await save(db, f.campus, id, input(f));
    await db.query("RESET ROLE");
    await db.query(
      'UPDATE "StockLot" SET status=\'RECEIVED\',"onHand"=3,"receivedAt"=now() WHERE "listingId"=$1',
      [id],
    );
    await as(db, f.alice.subject);
    await rejected(
      db,
      () =>
        save(
          db,
          f.campus,
          id,
          input(f, { quantity: 1 }),
          randomUUID(),
          r.data.updated_at,
        ),
      "INVALID_STATE",
    );
  }));
test("unverified sessions, foreign campuses and locations are rejected", async () =>
  fixture(async (db, f) => {
    await as(db, null);
    await rejected(
      db,
      () => save(db, f.campus, randomUUID(), input(f)),
      "UNAUTHENTICATED",
    );
    await as(db, f.unverified.subject);
    await rejected(
      db,
      () =>
        save(
          db,
          f.campus,
          randomUUID(),
          input(f, { images: [f.unverified.photo] }),
        ),
      "FORBIDDEN",
    );
    await as(db, f.alice.subject);
    await rejected(
      db,
      () => save(db, f.otherCampus, randomUUID(), input(f)),
      "FORBIDDEN",
    );
    await rejected(
      db,
      () =>
        save(
          db,
          f.campus,
          randomUUID(),
          input(f, { location_id: f.otherLocation }),
        ),
      "NOT_FOUND",
    );
  }));
test("uploads must exist, belong to the author, and use allowed image paths", async () =>
  fixture(async (db, f) => {
    await as(db, f.alice.subject);
    for (const images of [
      [],
      [f.bob.photo],
      [f.alice.subject + "/" + randomUUID() + ".jpg"],
      ["https://example.invalid/generated.svg"],
      [f.alice.subject + "/" + randomUUID() + ".svg"],
    ]) {
      await rejected(
        db,
        () => save(db, f.campus, randomUUID(), input(f, { images })),
        "VALIDATION_ERROR",
      );
    }
  }));
const food = () => ({
  food_name: "Sealed canned beans",
  date_label: "best_by",
  best_by: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  opened: false,
  shelf_stable: true,
  storage: "Store in a cool dry place",
  allergens: [],
  allergens_known: false,
});
test("food validation creates an accurate lot snapshot and rejects unsafe or missing metadata", async () =>
  fixture(async (db, f) => {
    await as(db, f.alice.subject);
    const id = randomUUID();
    const r = await save(
      db,
      f.campus,
      id,
      input(f, { category_id: "food", food: food() }),
    );
    assert.equal(r.data.food.allergens_known, false);
    await db.query("RESET ROLE");
    const snapshot = await db.query(
      'SELECT * FROM "StockFoodDetails" WHERE "stockLotId"=$1',
      [r.data.lots[0].lot_id],
    );
    assert.equal(snapshot.rows[0].photo, f.alice.photo);
    assert.equal(snapshot.rows[0].opened, false);
    await as(db, f.alice.subject);
    for (const invalid of [
      null,
      { ...food(), opened: true },
      { ...food(), shelf_stable: false },
      { ...food(), best_by: "2000-01-01" },
      { ...food(), best_by: "2026-02-30" },
      { ...food(), allergens: ["milk"] },
      { ...food(), storage: "" },
      { ...food(), allergens_known: null },
    ]) {
      await rejected(
        db,
        () =>
          save(
            db,
            f.campus,
            randomUUID(),
            input(f, { category_id: "food", food: invalid }),
          ),
        "VALIDATION_ERROR",
      );
    }
  }));
test("discovery combines filters, excludes foreign data and derives confirmed availability", async () =>
  fixture(async (db, f) => {
    await as(db, f.alice.subject);
    const offered = await save(db, f.campus, randomUUID(), input(f));
    await save(
      db,
      f.campus,
      randomUUID(),
      input(f, {
        kind: "request",
        images: [],
        title: "Need notebooks",
        category_id: "supplies",
      }),
    );
    let result = await db.query(
      "SELECT public.exchange_listings($1,'jacket','offer','clothing',$2,true) AS data",
      [f.campus, f.location],
    );
    assert.equal(result.rows[0].data.total, 0);
    await db.query("RESET ROLE");
    await db.query(
      'UPDATE "StockLot" SET status=\'RECEIVED\',"onHand"=3,"receivedAt"=now() WHERE "listingId"=$1',
      [offered.data.id],
    );
    await as(db, f.alice.subject);
    result = await db.query(
      "SELECT public.exchange_listings($1,'jacket','offer','clothing',$2,true) AS data",
      [f.campus, f.location],
    );
    assert.equal(result.rows[0].data.total, 1);
    assert.equal(result.rows[0].data.listings[0].lots[0].available, 3);
    assert.ok(
      !JSON.stringify(result.rows[0]).includes("@students.example.invalid"),
    );
    await as(db, f.outsider.subject);
    await rejected(
      db,
      () => db.query("SELECT public.exchange_listing($1)", [offered.data.id]),
      "NOT_FOUND",
    );
  }));
test("photo RLS allows listing viewers but not unrelated campuses, and protects attached photos", async () =>
  fixture(async (db, f) => {
    await as(db, f.alice.subject);
    await save(db, f.campus, randomUUID(), input(f));
    await as(db, f.bob.subject);
    let r = await db.query("SELECT name FROM storage.objects WHERE name=$1", [
      f.alice.photo,
    ]);
    assert.equal(r.rowCount, 1);
    await as(db, f.outsider.subject);
    r = await db.query("SELECT name FROM storage.objects WHERE name=$1", [
      f.alice.photo,
    ]);
    assert.equal(r.rowCount, 0);
    await as(db, f.alice.subject);
    r = await db.query(
      "DELETE FROM storage.objects WHERE name=$1 RETURNING name",
      [f.alice.photo],
    );
    assert.equal(r.rowCount, 0);
    const own = f.alice.subject + "/" + randomUUID() + ".png";
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name,owner_id)VALUES('listing-photos',$1,$2)",
      [own, f.alice.subject],
    );
    r = await db.query(
      "DELETE FROM storage.objects WHERE name=$1 RETURNING name",
      [own],
    );
    assert.equal(r.rowCount, 1);
  }));

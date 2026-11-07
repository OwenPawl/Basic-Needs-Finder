import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Authenticated inventory RPCs (202611070007_inventory_rpc), exercised as
// Supabase's Data API calls them: the `authenticated` role plus JWT claims.
// Every test runs inside a rolled-back transaction. Requires the test-only
// auth stand-in (npm run db:test-auth-shim) before migrations.
const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Inventory RPC tests require DATABASE_URL pointing to a dedicated database whose name ends in _test. Run the auth shim, migrations and seed first.",
  );

type Db = pg.Client;
type Envelope = {
  ok: boolean;
  replayed?: boolean;
  data?: {
    lot?: {
      status: string;
      on_hand: number;
      reserved: number;
      available: number;
    };
    reservation?: { reservation_id: string; status: string };
  };
  error?: { code: string };
};

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

async function as(db: Db, subject: string | null) {
  await db.query("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
    subject ? JSON.stringify({ sub: subject, role: "authenticated" }) : "",
  ]);
  await db.query("SET LOCAL ROLE authenticated");
}

async function asOwner(db: Db) {
  await db.query("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claims', '', true)");
}

async function rpc(db: Db, fn: string, ...args: unknown[]): Promise<Envelope> {
  const params = args.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await db.query(`SELECT public.${fn}(${params}) AS r`, args);
  return rows[0].r;
}
const code = (r: Envelope) => (r.ok ? "ok" : r.error!.code);
const key = () => randomUUID();

/** Expect a database error without aborting the surrounding transaction. */
async function rejects(
  db: Db,
  run: () => Promise<unknown>,
  expected: { code: string },
) {
  await db.query("SAVEPOINT expected_failure");
  await assert.rejects(run(), expected);
  await db.query("ROLLBACK TO SAVEPOINT expected_failure");
}

// Builds, as the migration owner, a fictional campus with two locations, a
// second campus, Supabase accounts for each person, and one pledged lot.
async function fixture(db: Db) {
  await asOwner(db);
  const campus = randomUUID();
  const other = randomUUID();
  await db.query(
    'INSERT INTO "Campus" (id,slug,name,"emailDomains","isDemo") VALUES ($1,$2,$3,$4,true),($5,$6,$7,$8,true)',
    [
      campus,
      `rpc-${campus}`,
      "Fictional RPC Campus",
      ["rpc.example.invalid"],
      other,
      `rpc-${other}`,
      "Fictional Other Campus",
      ["other.example.invalid"],
    ],
  );
  const commons = randomUUID();
  const library = randomUUID();
  const otherLocation = randomUUID();
  for (const [id, campusId] of [
    [commons, campus],
    [library, campus],
    [otherLocation, other],
  ])
    await db.query(
      'INSERT INTO "Location" (id,"campusId",name,building,hours,instructions) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, campusId, "Fictional location", "Example", "Example", "Example"],
    );
  const subjects: Record<string, string> = {};
  const members: Record<string, string> = {};
  const person = async (
    name: string,
    campusId: string,
    role: string,
    verified: boolean,
    staffAt?: string,
  ) => {
    subjects[name] = randomUUID();
    members[name] = randomUUID();
    const user = randomUUID();
    await db.query(
      "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, now())",
      [subjects[name], `${name}-${user.slice(0, 8)}@rpc.example.invalid`],
    );
    await db.query(
      'INSERT INTO "User" (id,"authSubject",email,"displayName") VALUES ($1,$2,$3,$4)',
      [user, subjects[name], `${user}@rpc.example.invalid`, name],
    );
    await db.query(
      'INSERT INTO "Membership" (id,"campusId","userId",role,"verifiedAt") VALUES ($1,$2,$3,$4,$5)',
      [members[name], campusId, user, role, verified ? new Date() : null],
    );
    if (staffAt)
      await db.query(
        'INSERT INTO "StaffAssignment" (id,"campusId","membershipId","locationId") VALUES ($1,$2,$3,$4)',
        [randomUUID(), campusId, members[name], staffAt],
      );
  };
  await person("donor", campus, "STUDENT", true);
  await person("student-a", campus, "STUDENT", true);
  await person("student-b", campus, "STUDENT", true);
  await person("unverified", campus, "STUDENT", false);
  await person("outsider", other, "STUDENT", true);
  await person("staff-commons", campus, "STAFF", true, commons);
  await person("staff-library", campus, "STAFF", true, library);
  const listing = randomUUID();
  const lot = randomUUID();
  await db.query(
    `INSERT INTO "Listing" (id,"campusId","authorId","categoryId","locationId",title,description,kind,quantity,images,"isDemo","updatedAt")
     VALUES ($1,$2,$3,'supplies',$4,'Fictional notebooks','Fictional notebooks','OFFER',2,'{}',true,now())`,
    [listing, campus, members.donor, commons],
  );
  await db.query(
    'INSERT INTO "StockLot" (id,"campusId","listingId","locationId",pledged) VALUES ($1,$2,$3,$4,2)',
    [lot, campus, listing, commons],
  );
  return { subjects, members, lot };
}

test("end to end: staff receipt, student reservation, staff pickup", async () => {
  await transaction(async (db) => {
    const { subjects, lot } = await fixture(db);
    await as(db, subjects["student-a"]);
    assert.equal(
      code(await rpc(db, "reserve_item", lot, 1, key())),
      "NOT_RESERVABLE",
      "pledged stock is not reservable",
    );
    await as(db, subjects["staff-commons"]);
    const receipt = await rpc(db, "confirm_receipt", lot, 2, key());
    assert.equal(code(receipt), "ok");
    assert.equal(receipt.data!.lot!.available, 2);
    await as(db, subjects["student-a"]);
    const hold = await rpc(db, "reserve_item", lot, 1, key());
    assert.equal(code(hold), "ok");
    assert.equal(hold.data!.lot!.available, 1);
    const reservation = hold.data!.reservation!.reservation_id;
    assert.equal(
      code(await rpc(db, "confirm_pickup", reservation, key())),
      "FORBIDDEN",
      "a student cannot confirm their own pickup",
    );
    await as(db, subjects["staff-commons"]);
    const pickup = await rpc(db, "confirm_pickup", reservation, key());
    assert.equal(code(pickup), "ok");
    assert.deepEqual(
      {
        on_hand: pickup.data!.lot!.on_hand,
        reserved: pickup.data!.lot!.reserved,
      },
      { on_hand: 1, reserved: 0 },
    );
  });
});

test("callers are resolved from the session, never from arguments", async () => {
  await transaction(async (db) => {
    const { subjects, lot } = await fixture(db);
    await as(db, null);
    assert.equal(
      code(await rpc(db, "reserve_item", lot, 1, key())),
      "UNAUTHENTICATED",
    );
    await as(db, subjects.outsider);
    assert.equal(
      code(await rpc(db, "reserve_item", lot, 1, key())),
      "NOT_FOUND",
      "other campus looks missing",
    );
    assert.equal(
      code(await rpc(db, "confirm_receipt", lot, 2, key())),
      "NOT_FOUND",
    );
    await as(db, subjects["student-a"]);
    assert.equal(
      code(await rpc(db, "reserve_item", randomUUID(), 1, key())),
      "NOT_FOUND",
      "unknown lot",
    );
    assert.equal(
      code(await rpc(db, "confirm_receipt", lot, 2, key())),
      "FORBIDDEN",
      "students cannot receive stock",
    );
    await as(db, subjects["staff-library"]);
    assert.equal(
      code(await rpc(db, "confirm_receipt", lot, 2, key())),
      "FORBIDDEN",
      "staff at another location cannot receive",
    );
    await asOwner(db);
    assert.equal(
      code(await rpc(db, "confirm_receipt", lot, 2, key())),
      "UNAUTHENTICATED",
      "no session means no actor, even for the owner role",
    );
  });
});

test("students can only cancel their own holds; staff at the location can release them", async () => {
  await transaction(async (db) => {
    const { subjects, lot } = await fixture(db);
    await as(db, subjects["staff-commons"]);
    await rpc(db, "confirm_receipt", lot, 2, key());
    await as(db, subjects.unverified);
    assert.equal(
      code(await rpc(db, "reserve_item", lot, 1, key())),
      "FORBIDDEN",
      "unverified members cannot reserve",
    );
    await as(db, subjects["student-a"]);
    const mine = (await rpc(db, "reserve_item", lot, 1, key())).data!
      .reservation!.reservation_id;
    await as(db, subjects["student-b"]);
    assert.equal(
      code(await rpc(db, "cancel_reservation", mine, key())),
      "NOT_FOUND",
    );
    await as(db, subjects["student-a"]);
    assert.equal(code(await rpc(db, "cancel_reservation", mine, key())), "ok");
    const again = (await rpc(db, "reserve_item", lot, 1, key())).data!
      .reservation!.reservation_id;
    await as(db, subjects["staff-library"]);
    assert.equal(
      code(await rpc(db, "cancel_reservation", again, key())),
      "FORBIDDEN",
    );
    await as(db, subjects["staff-commons"]);
    assert.equal(code(await rpc(db, "cancel_reservation", again, key())), "ok");
  });
});

test("staff corrections and removals go through the wrappers", async () => {
  await transaction(async (db) => {
    const { subjects, lot } = await fixture(db);
    await as(db, subjects["staff-commons"]);
    await rpc(db, "confirm_receipt", lot, 2, key());
    assert.equal(
      code(
        await rpc(db, "correct_stock", lot, 3, "Recount found one more", key()),
      ),
      "ok",
    );
    await as(db, subjects["student-a"]);
    assert.equal(
      code(await rpc(db, "correct_stock", lot, 9, "Attempt", key())),
      "FORBIDDEN",
    );
    assert.equal(
      code(await rpc(db, "remove_stock", lot, "Attempt", key())),
      "FORBIDDEN",
    );
    await as(db, subjects["staff-commons"]);
    const removed = await rpc(
      db,
      "remove_stock",
      lot,
      "Packaging damaged",
      key(),
    );
    assert.equal(code(removed), "ok");
    assert.equal(removed.data!.lot!.status, "removed");
  });
});

test("command outcomes return the envelope so side effects persist", async () => {
  await transaction(async (db) => {
    const { subjects, lot } = await fixture(db);
    await as(db, subjects["staff-commons"]);
    await rpc(db, "confirm_receipt", lot, 2, key());
    await as(db, subjects["student-a"]);
    const k = key();
    const first = await rpc(db, "reserve_item", lot, 5, k);
    assert.equal(code(first), "INSUFFICIENT_STOCK");
    const retry = await rpc(db, "reserve_item", lot, 5, k);
    assert.equal(
      retry.replayed,
      true,
      "a rejected command replays for the same key",
    );
    const hold = (await rpc(db, "reserve_item", lot, 1, key())).data!
      .reservation!.reservation_id;
    await asOwner(db);
    await db.query(
      `UPDATE "Reservation" SET "expiresAt" = now() - interval '1 second' WHERE id=$1`,
      [hold],
    );
    await as(db, subjects["staff-commons"]);
    assert.equal(
      code(await rpc(db, "confirm_pickup", hold, key())),
      "RESERVATION_EXPIRED",
    );
    await asOwner(db);
    const { rows } = await db.query(
      'SELECT lower(status::text) AS s FROM "Reservation" WHERE id=$1',
      [hold],
    );
    assert.equal(rows[0].s, "expired", "the hold release is not rolled back");
  });
});

test("browser roles cannot bypass the wrappers", async () => {
  await transaction(async (db) => {
    const { subjects, lot } = await fixture(db);
    await as(db, subjects["student-a"]);
    await rejects(
      db,
      () => db.query('UPDATE "StockLot" SET reserved = 0 WHERE id=$1', [lot]),
      { code: "42501" },
    );
    await rejects(
      db,
      () =>
        db.query("SELECT inventory.reserve($1,$2,1,'x')", [randomUUID(), lot]),
      { code: "42501" },
    );
    await db.query("RESET ROLE");
    await db.query("SET LOCAL ROLE anon");
    await rejects(db, () => rpc(db, "reserve_item", lot, 1, key()), {
      code: "42501",
    });
    await asOwner(db);
    const { rows } = await db.query(
      `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN
         ('reserve_item','cancel_reservation','confirm_receipt','confirm_pickup','correct_stock','remove_stock')`,
    );
    assert.equal(rows.length, 6);
    for (const row of rows) {
      assert.equal(
        row.authenticated,
        true,
        `${row.proname} callable by signed-in users`,
      );
      assert.equal(row.anon, false, `${row.proname} not callable anonymously`);
      assert.doesNotMatch(
        row.args,
        /actor|member/,
        `${row.proname} takes no actor argument`,
      );
    }
  });
});

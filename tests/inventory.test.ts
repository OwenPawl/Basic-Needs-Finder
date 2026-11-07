// Executable PostgreSQL tests for docs/inventory-test-vectors.json.
// Each test builds an isolated fictional campus through the real inventory
// commands, so the audit replay check below can prove on_hand from events.
import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Inventory tests require DATABASE_URL pointing to a dedicated database whose name ends in _test. Run migrations and seed first.",
  );

type Result = {
  ok: boolean;
  replayed?: boolean;
  data?: {
    lot?: {
      lot_id: string;
      status: string;
      on_hand: number;
      reserved: number;
      available: number;
    };
    reservation?: { reservation_id: string; status: string };
  };
  error?: { code: string };
};

async function connect() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

const db = await connect();
test.after(() => db.end());

async function call(
  client: pg.Client,
  fn: string,
  ...args: unknown[]
): Promise<Result> {
  const params = args.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await client.query(
    `SELECT inventory.${fn}(${params}) AS r`,
    args,
  );
  return rows[0].r;
}
const code = (r: Result) => (r.ok ? "ok" : r.error!.code);
const key = () => randomUUID();

async function lotState(id: string) {
  const { rows } = await db.query(
    'SELECT lower(status::text) AS status, "onHand" AS on_hand, reserved FROM "StockLot" WHERE id=$1',
    [id],
  );
  return rows[0] as { status: string; on_hand: number; reserved: number };
}
async function eventCount(lot: string) {
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM "InventoryEvent" WHERE "stockLotId"=$1',
    [lot],
  );
  return rows[0].n as number;
}
async function reservationStatus(id: string) {
  const { rows } = await db.query(
    'SELECT lower(status::text) AS s FROM "Reservation" WHERE id=$1',
    [id],
  );
  return rows[0].s as string;
}
async function expireNow(reservation: string, offset = "-1 second") {
  await db.query(
    `UPDATE "Reservation" SET "expiresAt" = now() + interval '${offset}' WHERE id=$1`,
    [reservation],
  );
}

// Invariant checks from the concurrency spec, run after every scenario.
async function assertInvariants(lot: string) {
  const s = await lotState(lot);
  assert.ok(
    s.reserved >= 0 && s.reserved <= s.on_hand,
    `0 <= reserved <= on_hand (${JSON.stringify(s)})`,
  );
  const active = await db.query(
    `SELECT COALESCE(sum(quantity),0)::int AS q FROM "Reservation" WHERE "stockLotId"=$1 AND status='ACTIVE'`,
    [lot],
  );
  assert.equal(
    s.reserved,
    active.rows[0].q,
    "reserved equals the sum of active holds",
  );
  const replay = await db.query(
    'SELECT COALESCE(sum("onHandDelta"),0)::int AS on_hand, COALESCE(sum("reservedDelta"),0)::int AS reserved FROM "InventoryEvent" WHERE "stockLotId"=$1',
    [lot],
  );
  assert.equal(
    s.on_hand,
    replay.rows[0].on_hand,
    "on_hand replays from inventory events",
  );
  assert.equal(
    s.reserved,
    replay.rows[0].reserved,
    "reserved replays from inventory events",
  );
  const terminal = await db.query(
    `SELECT "reservationId" FROM "InventoryEvent" WHERE "stockLotId"=$1 AND kind IN ('PICKUP','CANCEL','EXPIRE') GROUP BY 1 HAVING count(*) > 1`,
    [lot],
  );
  assert.equal(
    terminal.rowCount,
    0,
    "each reservation has at most one terminal event",
  );
}

// Fixture names follow the vectors: student-a, staff-commons, and so on.
async function campus(students = 2) {
  const id = randomUUID();
  const south = randomUUID();
  await db.query(
    'INSERT INTO "Campus" (id,slug,name,"emailDomains","isDemo") VALUES ($1,$2,$3,$4,true),($5,$6,$7,$8,true)',
    [
      id,
      `north-${id}`,
      "Fictional North Campus",
      ["north.example.invalid"],
      south,
      `south-${south}`,
      "Fictional South Campus",
      ["south.example.invalid"],
    ],
  );
  const locations: Record<string, string> = {};
  for (const [name, campusId] of [
    ["commons", id],
    ["library", id],
    ["south", south],
  ]) {
    locations[name] = randomUUID();
    await db.query(
      'INSERT INTO "Location" (id,"campusId",name,building,hours,instructions) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        locations[name],
        campusId,
        `Fictional ${name}`,
        "Example",
        "Example",
        "Example",
      ],
    );
  }
  const people: Record<string, string> = {};
  const add = async (
    name: string,
    campusId: string,
    role: string,
    verified: boolean,
    staffAt?: string,
  ) => {
    const user = randomUUID();
    people[name] = randomUUID();
    await db.query(
      'INSERT INTO "User" (id,email,"displayName") VALUES ($1,$2,$3)',
      [user, `${user}@example.invalid`, name],
    );
    await db.query(
      'INSERT INTO "Membership" (id,"campusId","userId",role,"verifiedAt") VALUES ($1,$2,$3,$4,$5)',
      [people[name], campusId, user, role, verified ? new Date() : null],
    );
    if (staffAt)
      await db.query(
        'INSERT INTO "StaffAssignment" (id,"campusId","membershipId","locationId") VALUES ($1,$2,$3,$4)',
        [randomUUID(), campusId, people[name], staffAt],
      );
  };
  await add("student-donor", id, "STUDENT", true);
  for (let i = 0; i < students; i++)
    await add(`student-${i}`, id, "STUDENT", true);
  await add("student-unverified", id, "STUDENT", false);
  await add("student-south", south, "STUDENT", true);
  await add("staff-commons", id, "STAFF", true, locations.commons);
  await add("staff-library", id, "STAFF", true, locations.library);
  await add("staff-south", south, "STAFF", true, locations.south);

  // A pledged lot at loc-commons. received > 0 confirms receipt through the real command.
  const lot = async (pledged: number, received = 0) => {
    const listing = randomUUID();
    const lotId = randomUUID();
    await db.query(
      `INSERT INTO "Listing" (id,"campusId","authorId","categoryId","locationId",title,description,kind,quantity,images,"isDemo","updatedAt")
       VALUES ($1,$2,$3,'supplies',$4,'Fictional test item','Fictional test item','OFFER',$5,'{}',true,now())`,
      [listing, id, people["student-donor"], locations.commons, pledged],
    );
    await db.query(
      'INSERT INTO "StockLot" (id,"campusId","listingId","locationId",pledged) VALUES ($1,$2,$3,$4,$5)',
      [lotId, id, listing, locations.commons, pledged],
    );
    if (received)
      assert.equal(
        code(
          await call(
            db,
            "receive",
            people["staff-commons"],
            lotId,
            received,
            key(),
          ),
        ),
        "ok",
      );
    return lotId;
  };
  const reserve = async (who: string, lotId: string, qty = 1) => {
    const r = await call(db, "reserve", people[who], lotId, qty, key());
    assert.equal(code(r), "ok", `${who} reserves`);
    return r.data!.reservation!.reservation_id;
  };
  return { people, lot, reserve };
}

test("receipts (R1-R8)", async () => {
  const { people, lot } = await campus();
  const staff = people["staff-commons"];
  const a = await lot(2);
  const r1 = await call(db, "receive", staff, a, 2, "rcv-1");
  assert.equal(code(r1), "ok");
  assert.deepEqual(await lotState(a), {
    status: "received",
    on_hand: 2,
    reserved: 0,
  });
  assert.equal(await eventCount(a), 1);
  const r2 = await call(db, "receive", staff, a, 2, "rcv-1");
  assert.equal(r2.replayed, true, "R2 replays");
  assert.equal(await eventCount(a), 1);
  assert.equal(
    code(await call(db, "receive", staff, a, 2, "rcv-2")),
    "INVALID_STATE",
    "R3",
  );
  assert.equal(
    code(await call(db, "receive", staff, a, 1, "rcv-1")),
    "IDEMPOTENCY_CONFLICT",
    "R4",
  );
  const partial = await lot(2);
  assert.equal(
    code(await call(db, "receive", staff, partial, 1, key())),
    "ok",
    "R5",
  );
  assert.deepEqual(await lotState(partial), {
    status: "received",
    on_hand: 1,
    reserved: 0,
  });
  const pledged = await lot(2);
  for (const qty of [0, -1, 3])
    assert.equal(
      code(await call(db, "receive", staff, pledged, qty, key())),
      "VALIDATION_ERROR",
      `R6 qty ${qty}`,
    );
  assert.equal(
    code(await call(db, "receive", people["staff-library"], pledged, 2, key())),
    "FORBIDDEN",
    "R7",
  );
  assert.equal(
    code(await call(db, "receive", people["student-donor"], pledged, 2, key())),
    "FORBIDDEN",
    "R8",
  );
  assert.equal(
    code(await call(db, "receive", people["staff-south"], pledged, 2, key())),
    "NOT_FOUND",
    "other campus",
  );
  assert.deepEqual(await lotState(pledged), {
    status: "pledged",
    on_hand: 0,
    reserved: 0,
  });
  assert.equal(
    await eventCount(pledged),
    0,
    "rejected receipts write no events",
  );
  for (const l of [a, partial, pledged]) await assertInvariants(l);
});

test("reservations (P2, V1-V9)", async () => {
  const { people, lot } = await campus();
  const pledged = await lot(2);
  assert.equal(
    code(await call(db, "reserve", people["student-0"], pledged, 1, key())),
    "NOT_RESERVABLE",
    "P2",
  );
  const two = await lot(2, 2);
  const v1 = await call(db, "reserve", people["student-0"], two, 1, "res-a1");
  assert.equal(code(v1), "ok", "V1");
  assert.equal(v1.data!.lot!.available, 1);
  const v2 = await call(db, "reserve", people["student-0"], two, 1, "res-a1");
  assert.equal(v2.replayed, true, "V2");
  assert.equal(
    v2.data!.reservation!.reservation_id,
    v1.data!.reservation!.reservation_id,
  );
  assert.equal(
    code(await call(db, "reserve", people["student-0"], two, 2, "res-a1")),
    "IDEMPOTENCY_CONFLICT",
    "V3",
  );
  assert.equal(
    code(await call(db, "reserve", people["student-1"], two, 2, key())),
    "INSUFFICIENT_STOCK",
    "V5",
  );
  assert.equal(
    code(await call(db, "reserve", people["student-1"], two, 1, key())),
    "ok",
    "V4",
  );
  assert.deepEqual(await lotState(two), {
    status: "received",
    on_hand: 2,
    reserved: 2,
  });
  const fresh = await lot(2, 2);
  for (const qty of [0, -1])
    assert.equal(
      code(await call(db, "reserve", people["student-0"], fresh, qty, key())),
      "VALIDATION_ERROR",
      `V6 qty ${qty}`,
    );
  assert.equal(
    code(
      await call(db, "reserve", people["student-unverified"], fresh, 1, key()),
    ),
    "FORBIDDEN",
    "V8",
  );
  assert.equal(
    code(await call(db, "reserve", people["student-south"], fresh, 1, key())),
    "NOT_FOUND",
    "V9",
  );
  const removed = await lot(1, 1);
  assert.equal(
    code(
      await call(
        db,
        "remove",
        people["staff-commons"],
        removed,
        "Damaged",
        key(),
      ),
    ),
    "ok",
  );
  assert.equal(
    code(await call(db, "reserve", people["student-0"], removed, 1, key())),
    "NOT_RESERVABLE",
    "V7",
  );
  for (const l of [pledged, two, fresh, removed]) await assertInvariants(l);
});

test("cancellation (C1-C7)", async () => {
  const { people, lot, reserve } = await campus();
  const two = await lot(2, 2);
  const held = await reserve("student-0", two);
  assert.equal(
    code(await call(db, "cancel", people["student-1"], held, key())),
    "NOT_FOUND",
    "C4",
  );
  assert.equal(
    code(await call(db, "cancel", people["staff-library"], held, key())),
    "FORBIDDEN",
    "C6",
  );
  assert.equal(
    code(await call(db, "cancel", people["staff-south"], held, key())),
    "NOT_FOUND",
    "other campus",
  );
  const c1 = await call(db, "cancel", people["student-0"], held, "can-a1");
  assert.equal(code(c1), "ok", "C1");
  assert.deepEqual(await lotState(two), {
    status: "received",
    on_hand: 2,
    reserved: 0,
  });
  assert.equal(
    (await call(db, "cancel", people["student-0"], held, "can-a1")).replayed,
    true,
    "C2",
  );
  assert.equal(
    code(await call(db, "cancel", people["student-0"], held, "can-a2")),
    "INVALID_STATE",
    "C3",
  );
  assert.equal(
    (await lotState(two)).reserved,
    0,
    "reserved never goes below zero",
  );
  const byStaff = await reserve("student-0", two);
  assert.equal(
    code(await call(db, "cancel", people["staff-commons"], byStaff, key())),
    "ok",
    "C5",
  );
  const picked = await reserve("student-0", two);
  assert.equal(
    code(await call(db, "pickup", people["staff-commons"], picked, key())),
    "ok",
  );
  assert.equal(
    code(await call(db, "cancel", people["student-0"], picked, key())),
    "INVALID_STATE",
    "C7",
  );
  await assertInvariants(two);
});

test("expiry (E1-E6)", async () => {
  const { people, lot, reserve } = await campus();
  const two = await lot(2, 2);
  const held = await reserve("student-0", two);
  await expireNow(held, "1 second");
  assert.equal(await call(db, "expire_sweep"), 0, "E1: not yet due");
  assert.equal(await reservationStatus(held), "active");
  await expireNow(held);
  const before = await eventCount(two);
  assert.ok(((await call(db, "expire_sweep")) as unknown as number) >= 1, "E2");
  assert.equal(await reservationStatus(held), "expired");
  assert.equal((await lotState(two)).reserved, 0);
  assert.equal(await eventCount(two), before + 1, "E2 one release event");
  await call(db, "expire_sweep");
  assert.equal(
    await eventCount(two),
    before + 1,
    "E3 second sweep releases nothing",
  );

  const last = await lot(1, 1);
  const stale = await reserve("student-0", last);
  await expireNow(stale);
  const e4 = await call(db, "reserve", people["student-1"], last, 1, key());
  assert.equal(
    code(e4),
    "ok",
    "E4: unswept expired hold does not block the last unit",
  );
  assert.equal(await reservationStatus(stale), "expired");
  assert.deepEqual(await lotState(last), {
    status: "received",
    on_hand: 1,
    reserved: 1,
  });

  const p = await reserve("student-0", two);
  await expireNow(p);
  assert.equal(
    code(await call(db, "pickup", people["staff-commons"], p, key())),
    "RESERVATION_EXPIRED",
    "E5",
  );
  assert.equal(await reservationStatus(p), "expired");
  assert.deepEqual(
    await lotState(two),
    { status: "received", on_hand: 2, reserved: 0 },
    "E5 hold released, stock kept",
  );
  const c = await reserve("student-0", two);
  await expireNow(c);
  assert.equal(
    code(await call(db, "cancel", people["student-0"], c, key())),
    "RESERVATION_EXPIRED",
    "E6",
  );
  assert.equal((await lotState(two)).reserved, 0);
  for (const l of [two, last]) await assertInvariants(l);
});

test("pickup (K1-K7)", async () => {
  const { people, lot, reserve } = await campus();
  const staff = people["staff-commons"];
  const two = await lot(2, 2);
  const held = await reserve("student-0", two);
  assert.equal(
    code(await call(db, "pickup", people["staff-library"], held, key())),
    "FORBIDDEN",
    "K5",
  );
  assert.equal(
    code(await call(db, "pickup", people["student-0"], held, key())),
    "FORBIDDEN",
    "K6",
  );
  assert.equal(
    code(await call(db, "pickup", people["staff-south"], held, key())),
    "NOT_FOUND",
    "A3",
  );
  assert.equal(code(await call(db, "pickup", staff, held, "pk-1")), "ok", "K1");
  assert.deepEqual(await lotState(two), {
    status: "received",
    on_hand: 1,
    reserved: 0,
  });
  assert.equal(
    (await call(db, "pickup", staff, held, "pk-1")).replayed,
    true,
    "K2",
  );
  assert.equal(
    code(await call(db, "pickup", staff, held, "pk-2")),
    "INVALID_STATE",
    "K3",
  );
  assert.equal((await lotState(two)).on_hand, 1, "pickup counted once");
  const cancelled = await reserve("student-0", two);
  assert.equal(
    code(await call(db, "cancel", people["student-0"], cancelled, key())),
    "ok",
  );
  assert.equal(
    code(await call(db, "pickup", staff, cancelled, key())),
    "INVALID_STATE",
    "K4",
  );
  const last = await lot(1, 1);
  const lastHold = await reserve("student-0", last);
  assert.equal(
    code(await call(db, "pickup", staff, lastHold, key())),
    "ok",
    "K7",
  );
  assert.deepEqual(await lotState(last), {
    status: "received",
    on_hand: 0,
    reserved: 0,
  });
  for (const l of [two, last]) await assertInvariants(l);
});

test("corrections (X1-X6)", async () => {
  const { people, lot, reserve } = await campus();
  const staff = people["staff-commons"];
  const two = await lot(2, 2);
  assert.equal(
    code(
      await call(
        db,
        "correct",
        staff,
        two,
        3,
        "Found an extra unit during recount",
        key(),
      ),
    ),
    "ok",
    "X1",
  );
  const audit = await db.query(
    `SELECT "onHandBefore","onHandAfter",reason FROM "InventoryEvent" WHERE "stockLotId"=$1 AND kind='CORRECTION'`,
    [two],
  );
  assert.deepEqual(audit.rows[0], {
    onHandBefore: 2,
    onHandAfter: 3,
    reason: "Found an extra unit during recount",
  });
  assert.equal(
    code(await call(db, "correct", staff, two, 1, "  ", key())),
    "VALIDATION_ERROR",
    "X2",
  );
  assert.equal(
    code(await call(db, "correct", staff, two, -1, "Typo", key())),
    "VALIDATION_ERROR",
    "X5",
  );
  await reserve("student-0", two, 2);
  assert.equal(
    code(await call(db, "correct", staff, two, 1, "Recount", key())),
    "WOULD_VIOLATE_RESERVATIONS",
    "X3",
  );
  assert.equal(
    code(await call(db, "correct", staff, two, 2, "Recount", key())),
    "ok",
    "X4: down to exactly reserved",
  );
  assert.equal(
    code(
      await call(db, "correct", people["student-0"], two, 5, "Attempt", key()),
    ),
    "FORBIDDEN",
    "X6 student",
  );
  assert.equal(
    code(
      await call(
        db,
        "correct",
        people["staff-library"],
        two,
        5,
        "Attempt",
        key(),
      ),
    ),
    "FORBIDDEN",
    "X6 other location",
  );
  assert.equal(
    code(
      await call(
        db,
        "correct",
        people["staff-south"],
        two,
        5,
        "Attempt",
        key(),
      ),
    ),
    "NOT_FOUND",
    "X6 other campus",
  );
  const pledged = await lot(2);
  assert.equal(
    code(
      await call(db, "correct", staff, pledged, 2, "Not received yet", key()),
    ),
    "INVALID_STATE",
    "pledged stock cannot be corrected into inventory",
  );
  for (const l of [two, pledged]) await assertInvariants(l);
});

test("removal of unsafe stock (U1-U5)", async () => {
  const { people, lot, reserve } = await campus();
  const staff = people["staff-commons"];
  const clean = await lot(2, 2);
  assert.equal(
    code(await call(db, "remove", staff, clean, "Packaging damaged", "rm-1")),
    "ok",
    "U1",
  );
  assert.deepEqual(await lotState(clean), {
    status: "removed",
    on_hand: 0,
    reserved: 0,
  });
  assert.equal(
    (await call(db, "remove", staff, clean, "Packaging damaged", "rm-1"))
      .replayed,
    true,
    "U5",
  );
  const held = await lot(2, 2);
  const hold = await reserve("student-0", held);
  assert.equal(
    code(await call(db, "remove", staff, held, "Recall notice", key())),
    "ok",
    "U2",
  );
  assert.equal(await reservationStatus(hold), "cancelled");
  assert.deepEqual(await lotState(held), {
    status: "removed",
    on_hand: 0,
    reserved: 0,
  });
  assert.equal(
    code(await call(db, "cancel", people["student-0"], hold, key())),
    "INVALID_STATE",
    "U3",
  );
  assert.equal(
    code(await call(db, "correct", staff, held, 3, "Undo", key())),
    "INVALID_STATE",
    "U4",
  );
  assert.equal(
    code(await call(db, "remove", staff, held, "", key())),
    "VALIDATION_ERROR",
    "removal needs a reason",
  );
  for (const l of [clean, held]) await assertInvariants(l);
});

test("database constraints back the commands", async () => {
  const { lot, reserve } = await campus();
  const two = await lot(2, 2);
  const hold = await reserve("student-0", two);
  await assert.rejects(
    db.query(`UPDATE "StockLot" SET status='REMOVED' WHERE id=$1`, [two]),
    { code: "23514" },
  );
  await assert.rejects(
    db.query(`UPDATE "Reservation" SET status='COMPLETED' WHERE id=$1`, [hold]),
    { code: "23514" },
  );
  const unexposed = await db.query(
    "SELECT has_schema_privilege('public', 'inventory', 'USAGE') AS usage, has_function_privilege('public', 'inventory.reserve(uuid,uuid,integer,text)', 'EXECUTE') AS exec",
  );
  assert.deepEqual(
    unexposed.rows[0],
    { usage: false, exec: false },
    "inventory commands are not callable by PUBLIC",
  );
});

// Concurrency: every racer uses its own connection, so these are independent
// transactions at READ COMMITTED. A barrier starts them together.
async function race<T>(
  n: number,
  run: (client: pg.Client, i: number) => Promise<T>,
) {
  const clients = await Promise.all(Array.from({ length: n }, connect));
  try {
    return await Promise.all(clients.map((c, i) => run(c, i)));
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}
const ITERATIONS = Number(process.env.INVENTORY_RACE_ITERATIONS ?? 50);

test("Q1: two students race for the last unit; exactly one wins", async () => {
  const { people, lot } = await campus(2);
  for (let i = 0; i < ITERATIONS; i++) {
    const last = await lot(1, 1);
    const results = await race(2, (c, j) =>
      call(c, "reserve", people[`student-${j}`], last, 1, key()),
    );
    assert.deepEqual(
      results.map(code).sort(),
      ["INSUFFICIENT_STOCK", "ok"],
      `iteration ${i}`,
    );
    assert.deepEqual(await lotState(last), {
      status: "received",
      on_hand: 1,
      reserved: 1,
    });
    await assertInvariants(last);
  }
});

test("Q1-stress: ten students race for the last unit", async () => {
  const { people, lot } = await campus(10);
  for (let i = 0; i < 10; i++) {
    const last = await lot(1, 1);
    const results = await race(10, (c, j) =>
      call(c, "reserve", people[`student-${j}`], last, 1, key()),
    );
    assert.equal(results.filter((r) => r.ok).length, 1, `iteration ${i}`);
    assert.equal((await lotState(last)).reserved, 1);
    await assertInvariants(last);
  }
});

test("Q2: one student double-submits the same reservation", async () => {
  const { people, lot } = await campus();
  for (let i = 0; i < 10; i++) {
    const two = await lot(2, 2);
    const k = key();
    const results = await race(2, (c) =>
      call(c, "reserve", people["student-0"], two, 1, k),
    );
    assert.ok(results.every((r) => r.ok));
    assert.equal(
      results[0].data!.reservation!.reservation_id,
      results[1].data!.reservation!.reservation_id,
    );
    assert.equal((await lotState(two)).reserved, 1);
    await assertInvariants(two);
  }
});

test("Q3: cancel races a new reservation for the same unit", async () => {
  const { people, lot, reserve } = await campus();
  for (let i = 0; i < 20; i++) {
    const last = await lot(1, 1);
    const hold = await reserve("student-0", last);
    const [cancel, other] = await race(2, (c, j) =>
      j === 0
        ? call(c, "cancel", people["student-0"], hold, key())
        : call(c, "reserve", people["student-1"], last, 1, key()),
    );
    assert.equal(code(cancel), "ok");
    assert.ok(["ok", "INSUFFICIENT_STOCK"].includes(code(other)));
    assert.equal((await lotState(last)).reserved, other.ok ? 1 : 0);
    await assertInvariants(last);
  }
});

test("Q4: expiry sweep races a reservation for an expired-held unit", async () => {
  const { people, lot, reserve } = await campus();
  for (let i = 0; i < 20; i++) {
    const last = await lot(1, 1);
    const hold = await reserve("student-0", last);
    await expireNow(hold);
    const [, other] = await race(2, (c, j) =>
      j === 0
        ? call(c, "expire_sweep")
        : call(c, "reserve", people["student-1"], last, 1, key()),
    );
    assert.equal(code(other), "ok");
    const expires = await db.query(
      `SELECT count(*)::int AS n FROM "InventoryEvent" WHERE "reservationId"=$1 AND kind='EXPIRE'`,
      [hold],
    );
    assert.equal(expires.rows[0].n, 1, "expired exactly once");
    await assertInvariants(last);
  }
});

test("Q5: pickup races cancel on the same reservation", async () => {
  const { people, lot, reserve } = await campus();
  for (let i = 0; i < 20; i++) {
    const two = await lot(2, 2);
    const hold = await reserve("student-0", two);
    const [pickup, cancel] = await race(2, (c, j) =>
      j === 0
        ? call(c, "pickup", people["staff-commons"], hold, key())
        : call(c, "cancel", people["student-0"], hold, key()),
    );
    assert.equal([pickup, cancel].filter((r) => r.ok).length, 1);
    assert.deepEqual(await lotState(two), {
      status: "received",
      on_hand: pickup.ok ? 1 : 2,
      reserved: 0,
    });
    await assertInvariants(two);
  }
});

test("Q6: pickup at the deadline cannot succeed", async () => {
  const { people, lot, reserve } = await campus();
  for (let i = 0; i < 10; i++) {
    const two = await lot(2, 2);
    const hold = await reserve("student-0", two);
    await expireNow(hold, "-1 millisecond");
    const [pickup] = await race(2, (c, j) =>
      j === 0
        ? call(c, "pickup", people["staff-commons"], hold, key())
        : call(c, "expire_sweep"),
    );
    assert.notEqual(code(pickup), "ok");
    assert.deepEqual(await lotState(two), {
      status: "received",
      on_hand: 2,
      reserved: 0,
    });
    await assertInvariants(two);
  }
});

test("Q7/Q8: duplicate pickup and receipt with different keys apply once", async () => {
  const { people, lot, reserve } = await campus();
  for (let i = 0; i < 20; i++) {
    const two = await lot(2, 2);
    const hold = await reserve("student-0", two);
    const pickups = await race(2, (c) =>
      call(c, "pickup", people["staff-commons"], hold, key()),
    );
    assert.deepEqual(pickups.map(code).sort(), ["INVALID_STATE", "ok"]);
    assert.equal((await lotState(two)).on_hand, 1);
    const pledged = await lot(2);
    const receipts = await race(2, (c) =>
      call(c, "receive", people["staff-commons"], pledged, 2, key()),
    );
    assert.deepEqual(receipts.map(code).sort(), ["INVALID_STATE", "ok"]);
    assert.equal((await lotState(pledged)).on_hand, 2);
    for (const l of [two, pledged]) await assertInvariants(l);
  }
});

test("Q9/Q10: removal and downward correction race reservations", async () => {
  const { people, lot, reserve } = await campus();
  for (let i = 0; i < 20; i++) {
    const last = await lot(1, 1);
    await race(2, (c, j) =>
      j === 0
        ? call(c, "remove", people["staff-commons"], last, "Unsafe", key())
        : call(c, "reserve", people["student-1"], last, 1, key()),
    );
    assert.deepEqual(
      await lotState(last),
      { status: "removed", on_hand: 0, reserved: 0 },
      "Q9",
    );
    await assertInvariants(last);

    const two = await lot(2, 2);
    await reserve("student-0", two);
    const [correction, other] = await race(2, (c, j) =>
      j === 0
        ? call(c, "correct", people["staff-commons"], two, 1, "Recount", key())
        : call(c, "reserve", people["student-1"], two, 1, key()),
    );
    assert.equal(
      [correction, other].filter((r) => r.ok).length,
      1,
      "Q10 exactly one wins",
    );
    await assertInvariants(two);
  }
});

test("negative control: an unsafe read-then-write reservation oversells", async () => {
  // Proves the harness really races: without the lot lock, both racers see
  // one available unit and both insert a hold. The real command must not.
  const { people, lot } = await campus(2);
  const last = await lot(1, 1);
  const created = await race<number>(2, async (c, j) => {
    const { rows } = await c.query(
      'SELECT "onHand" - reserved AS available, "campusId" FROM "StockLot" WHERE id=$1',
      [last],
    );
    await c.query("SELECT pg_sleep(0.2)");
    if (rows[0].available < 1) return 0;
    await c.query(
      `INSERT INTO "Reservation" (id,"campusId","stockLotId","memberId",quantity,status,"expiresAt","idempotencyKey") VALUES ($1,$2,$3,$4,1,'ACTIVE',now()+interval '1 hour',$5)`,
      [randomUUID(), rows[0].campusId, last, people[`student-${j}`], key()],
    );
    return 1;
  });
  assert.equal(
    created.reduce((a, b) => a + b, 0),
    2,
    "unsafe variant created two holds for one unit",
  );
});

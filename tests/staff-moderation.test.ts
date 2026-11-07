import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Staff moderation and counts (202611070010_staff_moderation) exercised as Supabase's Data
// API calls them: the `authenticated` role plus JWT claims, inside rolled-back
// transactions. Requires the test-only auth stand-in before migrations.
const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Staff moderation tests require DATABASE_URL pointing to a dedicated database whose name ends in _test. Run the auth shim, migrations and seed first.",
  );

type Db = pg.Client;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

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

async function rpc(db: Db, fn: string, ...args: unknown[]): Promise<Json> {
  const params = args.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await db.query(`SELECT public.${fn}(${params}) AS r`, args);
  return rows[0].r;
}
const key = () => randomUUID();

/** Expect an API_CONTRACT code raised by app.fail, keeping the transaction usable. */
async function fails(db: Db, run: () => Promise<unknown>, code: string) {
  await db.query("SAVEPOINT expected_failure");
  await assert.rejects(run(), { message: code });
  await db.query("ROLLBACK TO SAVEPOINT expected_failure");
}

async function fixture(db: Db) {
  await asOwner(db);
  const campus = randomUUID();
  const other = randomUUID();
  await db.query(
    'INSERT INTO "Campus" (id,slug,name,"emailDomains","isDemo") VALUES ($1,$2,$3,$4,true),($5,$6,$7,$8,true)',
    [
      campus,
      `staff-${campus}`,
      "Fictional Staff Campus",
      ["staff.example.invalid"],
      other,
      `staff-${other}`,
      "Fictional Other Campus",
      ["other.example.invalid"],
    ],
  );
  const commons = randomUUID();
  const library = randomUUID();
  const elsewhere = randomUUID();
  for (const [id, campusId, name] of [
    [commons, campus, "Fictional Commons Shelf"],
    [library, campus, "Fictional Library Locker"],
    [elsewhere, other, "Fictional Other Desk"],
  ])
    await db.query(
      'INSERT INTO "Location" (id,"campusId",name,building,hours,instructions) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, campusId, name, "Example Hall", "Weekdays 9-5", "Ask at the desk"],
    );
  const subjects: Record<string, string> = {};
  const members: Record<string, string> = {};
  const person = async (
    name: string,
    campusId: string,
    role: string,
    staffAt?: string,
  ) => {
    subjects[name] = randomUUID();
    members[name] = randomUUID();
    const user = randomUUID();
    await db.query(
      "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, now())",
      [subjects[name], `${name}-${user.slice(0, 8)}@staff.example.invalid`],
    );
    await db.query(
      'INSERT INTO "User" (id,"authSubject",email,"displayName") VALUES ($1,$2,$3,$4)',
      [user, subjects[name], `${user}@staff.example.invalid`, name],
    );
    await db.query(
      'INSERT INTO "Membership" (id,"campusId","userId",role,"verifiedAt") VALUES ($1,$2,$3,$4,now())',
      [members[name], campusId, user, role],
    );
    if (staffAt)
      await db.query(
        'INSERT INTO "StaffAssignment" (id,"campusId","membershipId","locationId") VALUES ($1,$2,$3,$4)',
        [randomUUID(), campusId, members[name], staffAt],
      );
  };
  await person("donor", campus, "STUDENT");
  await person("student", campus, "STUDENT");
  await person("outsider", other, "STUDENT");
  await person("staff-commons", campus, "STAFF", commons);
  await person("staff-library", campus, "STAFF", library);
  await person("admin-unassigned", campus, "ADMIN");

  const listing = async (
    kind: "OFFER" | "REQUEST",
    category: string,
    title: string,
    pledged?: number,
    food = false,
  ) => {
    const listingId = randomUUID();
    await db.query(
      `INSERT INTO "Listing" (id,"campusId","authorId","categoryId","locationId",title,description,kind,quantity,images,"isDemo","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,'{}',true,now())`,
      [
        listingId,
        campus,
        members.donor,
        category,
        commons,
        title,
        kind,
        pledged ?? null,
      ],
    );
    if (!pledged) return { listingId, lotId: "" };
    const lotId = randomUUID();
    await db.query(
      'INSERT INTO "StockLot" (id,"campusId","listingId","locationId",pledged) VALUES ($1,$2,$3,$4,$5)',
      [lotId, campus, listingId, commons, pledged],
    );
    if (food)
      await db.query(
        `INSERT INTO "StockFoodDetails" ("stockLotId","foodName",photo,"dateLabel","bestBy",opened,"shelfStable",storage,allergens,"allergensKnown")
         VALUES ($1,'Fictional rolled oats','fixture://oats.jpg','Best by 2099-01-01','2099-01-01',false,true,'Room temperature','{}',false)`,
        [lotId],
      );
    return { listingId, lotId };
  };
  const notebooks = await listing(
    "OFFER",
    "supplies",
    "Fictional notebooks",
    2,
  );
  const oats = await listing("OFFER", "food", "Fictional oats", 3, true);
  const request = await listing(
    "REQUEST",
    "household",
    "Fictional desk lamp request",
  );
  return { subjects, members, commons, library, notebooks, oats, request };
}

const counts = (db: Db, location: string) => rpc(db, "staff_counts", location);
const history = async (db: Db, location: string) =>
  (await rpc(db, "staff_moderation_history", location)) as unknown as Json[];

test("only staff assigned to the location can read counts and history", async () => {
  await transaction(async (db) => {
    const { subjects, commons, library } = await fixture(db);
    await as(db, null);
    await fails(db, () => counts(db, commons), "UNAUTHENTICATED");
    await as(db, subjects.student);
    await fails(db, () => counts(db, commons), "FORBIDDEN");
    await fails(db, () => history(db, commons), "FORBIDDEN");
    await as(db, subjects["staff-library"]);
    await fails(db, () => counts(db, commons), "FORBIDDEN");
    await as(db, subjects["admin-unassigned"]);
    await fails(db, () => counts(db, commons), "FORBIDDEN");
    await as(db, subjects.outsider);
    await fails(db, () => counts(db, commons), "NOT_FOUND");
    await as(db, subjects["staff-library"]);
    assert.equal((await counts(db, library)).pending_dropoffs, 0);
  });
});

test("counts follow receipt, hold and pickup through the exchange RPCs", async () => {
  await transaction(async (db) => {
    const { subjects, commons, notebooks, request } = await fixture(db);
    await as(db, subjects["staff-commons"]);
    assert.deepEqual(await counts(db, commons), {
      available_units: 0,
      pending_dropoffs: 2,
      active_holds: 0,
      open_requests: 1,
      completed_exchanges: 0,
      open_reports: 0,
    });
    assert.ok(
      (await rpc(db, "exchange_receive", notebooks.lotId, 2, key())).data,
    );
    await as(db, subjects.student);
    const hold = await rpc(db, "exchange_reserve", notebooks.lotId, 1, key());
    const reservationId = hold.data.reservation.reservation_id;
    await as(db, subjects["staff-commons"]);
    let c = await counts(db, commons);
    assert.equal(c.available_units, 1);
    assert.equal(c.pending_dropoffs, 1);
    assert.equal(c.active_holds, 1);
    assert.ok((await rpc(db, "exchange_pickup", reservationId, key())).data);
    c = await counts(db, commons);
    assert.equal(c.completed_exchanges, 1);
    assert.equal(c.active_holds, 0);
    assert.equal(request.lotId, "", "requests never create stock");
  });
});

test("food past its date is not counted as available", async () => {
  await transaction(async (db) => {
    const { subjects, commons, oats } = await fixture(db);
    await as(db, subjects["staff-commons"]);
    assert.ok((await rpc(db, "exchange_receive", oats.lotId, 3, key())).data);
    assert.equal((await counts(db, commons)).available_units, 3);
    await asOwner(db);
    await db.query(
      `UPDATE "StockFoodDetails" SET "bestBy" = current_date - 2 WHERE "stockLotId"=$1`,
      [oats.lotId],
    );
    await as(db, subjects["staff-commons"]);
    assert.equal((await counts(db, commons)).available_units, 0);
  });
});

test("reported listings can be removed with a reason, withdrawing pledged stock", async () => {
  await transaction(async (db) => {
    const { subjects, commons, notebooks } = await fixture(db);
    await as(db, subjects.student);
    const report = await rpc(
      db,
      "report_listing",
      notebooks.listingId,
      "Looks like a duplicate post",
    );
    await fails(
      db,
      () =>
        rpc(
          db,
          "staff_moderate_listing",
          notebooks.listingId,
          "remove",
          "Student attempt",
          null,
        ),
      "FORBIDDEN",
    );
    await as(db, subjects["staff-library"]);
    await fails(
      db,
      () =>
        rpc(
          db,
          "staff_moderate_listing",
          notebooks.listingId,
          "remove",
          "Wrong location",
          null,
        ),
      "FORBIDDEN",
    );
    await as(db, subjects["staff-commons"]);
    assert.equal((await counts(db, commons)).open_reports, 1);
    await fails(
      db,
      () =>
        rpc(
          db,
          "staff_moderate_listing",
          notebooks.listingId,
          "remove",
          "no",
          null,
        ),
      "VALIDATION_ERROR",
    );
    await fails(
      db,
      () =>
        rpc(
          db,
          "staff_moderate_listing",
          notebooks.listingId,
          "hide",
          "Duplicate post",
          null,
        ),
      "VALIDATION_ERROR",
    );
    await fails(
      db,
      () =>
        rpc(
          db,
          "staff_moderate_listing",
          notebooks.listingId,
          "remove",
          "Duplicate post",
          randomUUID(),
        ),
      "INVALID_STATE",
    );
    const result = await rpc(
      db,
      "staff_moderate_listing",
      notebooks.listingId,
      "remove",
      "Duplicate of another post",
      report.report_id,
    );
    assert.deepEqual(result, {
      listing_id: notebooks.listingId,
      status: "removed",
      report_resolved: true,
    });
    await fails(
      db,
      () =>
        rpc(
          db,
          "staff_moderate_listing",
          notebooks.listingId,
          "remove",
          "Again please",
          null,
        ),
      "INVALID_STATE",
    );
    const c = await counts(db, commons);
    assert.equal(c.open_reports, 0);
    assert.equal(
      c.pending_dropoffs,
      1,
      "the withdrawn pledge leaves the drop-off count",
    );
    const log = await history(db, commons);
    assert.equal(log[0].action, "remove_listing");
    assert.equal(log[0].reason, "Duplicate of another post");
    assert.equal(log[0].report_id, report.report_id);
    await asOwner(db);
    const lot = await db.query(
      'SELECT lower(status::text) AS s FROM "StockLot" WHERE id=$1',
      [notebooks.lotId],
    );
    assert.equal(
      lot.rows[0].s,
      "removed",
      "a removed listing's pledge can never be received",
    );
    await as(db, subjects["staff-commons"]);
    assert.equal(
      (await rpc(db, "exchange_receive", notebooks.lotId, 2, key())).error.code,
      "INVALID_STATE",
    );
    const restored = await rpc(
      db,
      "staff_moderate_listing",
      notebooks.listingId,
      "restore",
      "Author clarified the post",
      null,
    );
    assert.equal(restored.status, "open");
  });
});

test("removing a listing withdraws received stock and cancels its active holds", async () => {
  await transaction(async (db) => {
    const { subjects, commons, notebooks } = await fixture(db);
    await as(db, subjects["staff-commons"]);
    assert.ok(
      (await rpc(db, "exchange_receive", notebooks.lotId, 2, key())).data,
    );
    await as(db, subjects.student);
    const held = (await rpc(db, "exchange_reserve", notebooks.lotId, 1, key()))
      .data.reservation.reservation_id;
    await as(db, subjects["staff-commons"]);
    assert.equal((await counts(db, commons)).active_holds, 1);
    await rpc(
      db,
      "staff_moderate_listing",
      notebooks.listingId,
      "remove",
      "Item is not allowed here",
      null,
    );
    await asOwner(db);
    const lot = await db.query(
      'SELECT lower(status::text) AS s, "onHand" AS on_hand, reserved FROM "StockLot" WHERE id=$1',
      [notebooks.lotId],
    );
    assert.deepEqual(lot.rows[0], { s: "removed", on_hand: 0, reserved: 0 });
    const hold = await db.query(
      'SELECT lower(status::text) AS s FROM "Reservation" WHERE id=$1',
      [held],
    );
    assert.equal(
      hold.rows[0].s,
      "cancelled",
      "the active hold is cancelled in the same transaction",
    );
    const events = await db.query(
      'SELECT lower(kind::text) AS k FROM "InventoryEvent" WHERE "stockLotId"=$1 ORDER BY k',
      [notebooks.lotId],
    );
    assert.deepEqual(
      events.rows.map((e) => e.k),
      ["cancel", "receipt", "remove", "reserve"],
      "removal is audited",
    );
    await as(db, subjects.student);
    assert.equal(
      (await rpc(db, "exchange_reserve", notebooks.lotId, 1, key())).error.code,
      "NOT_RESERVABLE",
    );
    await as(db, subjects["staff-commons"]);
    assert.equal(
      (await rpc(db, "exchange_pickup", held, key())).error.code,
      "INVALID_STATE",
      "a remembered reservation id cannot be collected",
    );
    assert.equal(
      (await rpc(db, "exchange_receive", notebooks.lotId, 2, key())).error.code,
      "INVALID_STATE",
    );
    const c = await counts(db, commons);
    assert.equal(c.available_units, 0);
    assert.equal(c.active_holds, 0);
    await rpc(
      db,
      "staff_moderate_listing",
      notebooks.listingId,
      "restore",
      "Author clarified the post",
      null,
    );
    await as(db, subjects.student);
    assert.equal(
      (await rpc(db, "exchange_reserve", notebooks.lotId, 1, key())).error.code,
      "NOT_RESERVABLE",
      "restoring the listing does not revive withdrawn stock",
    );
  });
});

test("reports can be dismissed with a recorded reason", async () => {
  await transaction(async (db) => {
    const { subjects, commons, oats } = await fixture(db);
    await as(db, subjects.student);
    const report = await rpc(
      db,
      "report_listing",
      oats.listingId,
      "Unsure if this is allowed",
    );
    await fails(
      db,
      () =>
        rpc(db, "staff_dismiss_report", report.report_id, "Student attempt"),
      "FORBIDDEN",
    );
    await as(db, subjects["staff-commons"]);
    await fails(
      db,
      () => rpc(db, "staff_dismiss_report", report.report_id, "ok"),
      "VALIDATION_ERROR",
    );
    assert.deepEqual(
      await rpc(
        db,
        "staff_dismiss_report",
        report.report_id,
        "Sealed oats are allowed",
      ),
      {
        report_id: report.report_id,
        resolved: true,
      },
    );
    await fails(
      db,
      () => rpc(db, "staff_dismiss_report", report.report_id, "Twice over"),
      "INVALID_STATE",
    );
    assert.equal((await counts(db, commons)).open_reports, 0);
    const log = await history(db, commons);
    assert.equal(log[0].action, "dismiss_report");
    assert.equal(log[0].reason, "Sealed oats are allowed");
    assert.doesNotMatch(
      JSON.stringify(log),
      /@/,
      "history carries no contact details",
    );
  });
});

test("moderation RPCs are signed-in only and the moderation log is private", async () => {
  await transaction(async (db) => {
    const { subjects, commons } = await fixture(db);
    await as(db, subjects["staff-commons"]);
    await db.query("SAVEPOINT expected_failure");
    await assert.rejects(db.query("SELECT * FROM app.moderation_action"), {
      code: "42501",
    });
    await db.query("ROLLBACK TO SAVEPOINT expected_failure");
    await db.query("RESET ROLE");
    await db.query("SET LOCAL ROLE anon");
    for (const call of [
      () => counts(db, commons),
      () => history(db, commons),
    ]) {
      await db.query("SAVEPOINT expected_failure");
      await assert.rejects(call(), { code: "42501" });
      await db.query("ROLLBACK TO SAVEPOINT expected_failure");
    }
  });
});

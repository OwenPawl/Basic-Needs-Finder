import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Staff console RPCs (202611070009_staff_console) exercised as Supabase's Data
// API calls them: the `authenticated` role plus JWT claims, inside rolled-back
// transactions. Requires the test-only auth stand-in before migrations.
const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Staff console tests require DATABASE_URL pointing to a dedicated database whose name ends in _test. Run the auth shim, migrations and seed first.",
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

test("only staff assigned to the location can open its dashboard", async () => {
  await transaction(async (db) => {
    const { subjects, commons, library } = await fixture(db);
    await as(db, null);
    await fails(
      db,
      () => rpc(db, "staff_dashboard", commons),
      "UNAUTHENTICATED",
    );
    await as(db, subjects.student);
    await fails(db, () => rpc(db, "staff_dashboard", commons), "FORBIDDEN");
    await as(db, subjects["staff-library"]);
    await fails(db, () => rpc(db, "staff_dashboard", commons), "FORBIDDEN");
    await as(db, subjects["admin-unassigned"]);
    await fails(db, () => rpc(db, "staff_dashboard", commons), "FORBIDDEN");
    await as(db, subjects.outsider);
    await fails(db, () => rpc(db, "staff_dashboard", commons), "NOT_FOUND");
    await as(db, subjects["staff-library"]);
    const own = await rpc(db, "staff_dashboard", library);
    assert.equal(own.location.location_id, library);
  });
});

test("receipt, hold and pickup change the dashboard from persisted data", async () => {
  await transaction(async (db) => {
    const { subjects, commons, notebooks, request } = await fixture(db);
    await as(db, subjects["staff-commons"]);
    let board = await rpc(db, "staff_dashboard", commons);
    assert.deepEqual(board.counts, {
      available_units: 0,
      pending_dropoffs: 2,
      active_holds: 0,
      open_requests: 1,
      completed_exchanges: 0,
      open_reports: 0,
    });
    assert.ok(
      board.dropoffs.some(
        (d: Json) => d.lot.lot_id === notebooks.lotId && d.lot.available === 0,
      ),
      "pledged stock is never available",
    );
    assert.equal(
      (await rpc(db, "confirm_receipt", notebooks.lotId, 2, key())).ok,
      true,
    );
    await as(db, subjects.student);
    const hold = await rpc(db, "reserve_item", notebooks.lotId, 1, key());
    const reservationId = hold.data.reservation.reservation_id;
    await as(db, subjects["staff-commons"]);
    board = await rpc(db, "staff_dashboard", commons);
    assert.equal(board.counts.available_units, 1);
    assert.equal(board.counts.pending_dropoffs, 1);
    assert.equal(board.counts.active_holds, 1);
    const listed = board.holds.find(
      (h: Json) => h.reservation_id === reservationId,
    );
    assert.match(listed.pickup_code, /^[0-9A-F]{8}$/);
    assert.equal(listed.title, "Fictional notebooks");
    assert.equal(
      (await rpc(db, "confirm_pickup", reservationId, key())).ok,
      true,
    );
    board = await rpc(db, "staff_dashboard", commons);
    assert.equal(board.counts.completed_exchanges, 1);
    assert.equal(board.counts.active_holds, 0);
    // Events from one transaction share a timestamp, so check membership, not order.
    assert.deepEqual(board.recent_events.map((e: Json) => e.kind).sort(), [
      "pickup",
      "receipt",
      "reserve",
    ]);
    assert.equal(
      board.recent_events.find((e: Json) => e.kind === "receipt").by_staff,
      true,
    );
    assert.equal(request.lotId, "", "requests never create stock");
    assert.doesNotMatch(
      JSON.stringify(board),
      /@/,
      "dashboard carries no email addresses",
    );
  });
});

test("food drop-offs show batch details, and past-date stock is flagged for removal", async () => {
  await transaction(async (db) => {
    const { subjects, commons, oats } = await fixture(db);
    await as(db, subjects["staff-commons"]);
    let board = await rpc(db, "staff_dashboard", commons);
    const dropoff = board.dropoffs.find(
      (d: Json) => d.lot.lot_id === oats.lotId,
    );
    assert.equal(dropoff.is_food, true);
    assert.equal(dropoff.food.package_status, "sealed");
    assert.equal(
      dropoff.food.allergens,
      null,
      "unknown allergens are shown as unknown, not none",
    );
    assert.equal(
      (await rpc(db, "confirm_receipt", oats.lotId, 3, key())).ok,
      true,
    );
    await asOwner(db);
    await db.query(
      `UPDATE "StockFoodDetails" SET "bestBy" = current_date - 1 WHERE "stockLotId"=$1`,
      [oats.lotId],
    );
    await as(db, subjects["staff-commons"]);
    board = await rpc(db, "staff_dashboard", commons);
    assert.equal(
      board.inventory.find((l: Json) => l.lot_id === oats.lotId).past_date,
      true,
    );
    const removed = await rpc(
      db,
      "remove_stock",
      oats.lotId,
      "Past best-by date",
      key(),
    );
    assert.equal(removed.data.lot.status, "removed");
    await as(db, subjects.student);
    assert.equal(
      (await rpc(db, "reserve_item", oats.lotId, 1, key())).error.code,
      "NOT_RESERVABLE",
    );
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
          "moderate_listing",
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
          "moderate_listing",
          notebooks.listingId,
          "remove",
          "Wrong location",
          null,
        ),
      "FORBIDDEN",
    );
    await as(db, subjects["staff-commons"]);
    let board = await rpc(db, "staff_dashboard", commons);
    assert.equal(board.counts.open_reports, 1);
    assert.equal(board.reports[0].reason, "Looks like a duplicate post");
    await fails(
      db,
      () =>
        rpc(db, "moderate_listing", notebooks.listingId, "remove", "no", null),
      "VALIDATION_ERROR",
    );
    await fails(
      db,
      () =>
        rpc(
          db,
          "moderate_listing",
          notebooks.listingId,
          "hide",
          "Duplicate post",
          null,
        ),
      "VALIDATION_ERROR",
    );
    const result = await rpc(
      db,
      "moderate_listing",
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
          "moderate_listing",
          notebooks.listingId,
          "remove",
          "Again",
          null,
        ),
      "INVALID_STATE",
    );
    board = await rpc(db, "staff_dashboard", commons);
    assert.equal(board.counts.open_reports, 0);
    assert.ok(
      !board.dropoffs.some((d: Json) => d.lot.lot_id === notebooks.lotId),
      "withdrawn pledge leaves the drop-off queue",
    );
    assert.equal(board.moderation[0].action, "remove_listing");
    assert.equal(board.moderation[0].reason, "Duplicate of another post");
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
      (await rpc(db, "confirm_receipt", notebooks.lotId, 2, key())).error.code,
      "INVALID_STATE",
    );
    const restored = await rpc(
      db,
      "moderate_listing",
      notebooks.listingId,
      "restore",
      "Author clarified the post",
      null,
    );
    assert.equal(restored.status, "open");
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
      () => rpc(db, "resolve_report", report.report_id, "Student attempt"),
      "FORBIDDEN",
    );
    await as(db, subjects["staff-commons"]);
    assert.deepEqual(
      await rpc(
        db,
        "resolve_report",
        report.report_id,
        "Sealed oats are allowed",
      ),
      { report_id: report.report_id, resolved: true },
    );
    await fails(
      db,
      () => rpc(db, "resolve_report", report.report_id, "Twice"),
      "INVALID_STATE",
    );
    const board = await rpc(db, "staff_dashboard", commons);
    assert.equal(board.counts.open_reports, 0);
    assert.equal(board.moderation[0].action, "dismiss_report");
  });
});

test("staff console RPCs are signed-in only and the moderation log is private", async () => {
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
    await db.query("SAVEPOINT expected_failure");
    await assert.rejects(rpc(db, "staff_dashboard", commons), {
      code: "42501",
    });
    await db.query("ROLLBACK TO SAVEPOINT expected_failure");
  });
});

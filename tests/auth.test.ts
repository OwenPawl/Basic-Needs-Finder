import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { seedId } from "../prisma/demo-data";

// Access-control checks for student-auth, run against real PostgreSQL with the
// same role switching Supabase's Data API performs (authenticated / anon plus
// JWT claims). Every test runs inside a rolled-back transaction.
const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Auth tests require DATABASE_URL pointing to a dedicated database whose name ends in _test. Run migrations and seed first.",
  );

const DEMO_CAMPUS = seedId(1);
const DEMO_DOMAIN = "students.example.invalid";
const UNION = seedId(10);
const MAIL_CENTER = seedId(11);

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

/** Create a Supabase-style account (as the migration owner). */
async function account(
  db: Db,
  { domain = DEMO_DOMAIN, confirmed = true } = {},
) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, $3)",
    [id, `user-${id.slice(0, 8)}@${domain}`, confirmed ? new Date() : null],
  );
  return id;
}

/** Act as a signed-in browser session for the given auth subject. */
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

async function rpc(db: Db, fn: string, args: unknown[] = []) {
  const params = args.map((_, i) => `$${i + 1}`).join(", ");
  const result = await db.query(`SELECT public.${fn}(${params}) AS r`, args);
  return result.rows[0].r;
}

const code = (message: string) => ({ message });

/** Expect a failure without aborting the surrounding test transaction. */
async function rejects(
  db: Db,
  run: () => Promise<unknown>,
  expected: Record<string, unknown>,
) {
  await db.query("SAVEPOINT expected_failure");
  await assert.rejects(run(), expected);
  await db.query("ROLLBACK TO SAVEPOINT expected_failure");
}

/** Signed-up, email-confirmed, campus-verified student. */
async function verifiedStudent(db: Db, name = "Test Student") {
  const subject = await account(db);
  await as(db, subject);
  await rpc(db, "upsert_profile", [name]);
  const session = await rpc(db, "verify_campus_membership", ["demo-campus"]);
  await asOwner(db);
  return { subject, memberId: session.memberships[0].membership_id as string };
}

async function demoListing(db: Db) {
  await asOwner(db);
  const { rows } = await db.query(
    `SELECT id FROM "Listing" WHERE "campusId" = $1 AND status = 'OPEN' ORDER BY id LIMIT 1`,
    [DEMO_CAMPUS],
  );
  return rows[0].id as string;
}

async function otherCampus(db: Db) {
  await asOwner(db);
  const campus = randomUUID(),
    location = randomUUID(),
    user = randomUUID(),
    member = randomUUID(),
    listing = randomUUID();
  await db.query(
    `INSERT INTO "Campus" (id, slug, name, "emailDomains", "isDemo") VALUES ($1, $2, 'Other demo campus', ARRAY['other.example.invalid'], true)`,
    [campus, `other-${campus.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO "Location" (id, "campusId", name, building, hours, instructions) VALUES ($1, $2, 'Other desk', 'X', 'X', 'X')`,
    [location, campus],
  );
  await db.query(
    `INSERT INTO "User" (id, email, "displayName") VALUES ($1, $2, 'Other student')`,
    [user, `other-${user.slice(0, 8)}@other.example.invalid`],
  );
  await db.query(
    `INSERT INTO "Membership" (id, "campusId", "userId", role, "verifiedAt") VALUES ($1, $2, $3, 'STUDENT', now())`,
    [member, campus, user],
  );
  await db.query(
    `INSERT INTO "Listing" (id, "campusId", "authorId", "categoryId", "locationId", title, description, kind, images, "updatedAt")
     VALUES ($1, $2, $3, 'other', $4, 'Other campus item', 'Fictional', 'OFFER', '{}', now())`,
    [listing, campus, member, location],
  );
  return { campus, location, member, listing };
}

test("requests without a session are rejected and anon has no data access", async () => {
  await transaction(async (db) => {
    await as(db, null);
    await rejects(db, () => rpc(db, "my_session"), code("UNAUTHENTICATED"));
    await rejects(
      db,
      () => rpc(db, "verify_campus_membership", ["demo-campus"]),
      code("UNAUTHENTICATED"),
    );
  });
  await transaction(async (db) => {
    await db.query("SET LOCAL ROLE anon");
    await rejects(db, () => db.query('SELECT 1 FROM "Listing" LIMIT 1'), {
      code: "42501",
    });
    await rejects(db, () => db.query("SELECT public.my_session()"), {
      code: "42501",
    });
  });
});

test("verification requires a confirmed email on a configured campus domain", async () => {
  await transaction(async (db) => {
    const unconfirmed = await account(db, { confirmed: false });
    await as(db, unconfirmed);
    await rpc(db, "upsert_profile", ["Unconfirmed"]);
    await rejects(
      db,
      () => rpc(db, "verify_campus_membership", ["demo-campus"]),
      code("FORBIDDEN"),
    );
    await asOwner(db);
    const wrongDomain = await account(db, { domain: "mail.example.com" });
    await as(db, wrongDomain);
    await rpc(db, "upsert_profile", ["Wrong domain"]);
    await rejects(
      db,
      () => rpc(db, "verify_campus_membership", ["demo-campus"]),
      code("FORBIDDEN"),
    );
    await rejects(
      db,
      () => rpc(db, "verify_campus_membership", ["no-such-campus"]),
      code("NOT_FOUND"),
    );
    const session = await rpc(db, "my_session");
    assert.deepEqual(session.memberships, []);
  });
});

test("a verified student gets a student session with no contact data", async () => {
  await transaction(async (db) => {
    const subject = await account(db);
    await as(db, subject);
    await rejects(
      db,
      () => rpc(db, "upsert_profile", ["   "]),
      code("VALIDATION_ERROR"),
    );
    await rpc(db, "upsert_profile", ["Rowan"]);
    const session = await rpc(db, "verify_campus_membership", ["demo-campus"]);
    assert.equal(session.user.display_name, "Rowan");
    assert.equal(session.email_confirmed, true);
    assert.equal(session.memberships.length, 1);
    assert.deepEqual(
      {
        campus: session.memberships[0].campus_id,
        role: session.memberships[0].role,
        verified: session.memberships[0].verified,
        staff: session.memberships[0].staff_location_ids,
      },
      { campus: DEMO_CAMPUS, role: "student", verified: true, staff: [] },
    );
    assert.doesNotMatch(JSON.stringify(session), /@|email"/);
    // Re-verifying is idempotent and never changes the role.
    const again = await rpc(db, "verify_campus_membership", ["demo-campus"]);
    assert.equal(
      again.memberships[0].membership_id,
      session.memberships[0].membership_id,
    );
    // Only the caller's own User row (with its private email) is readable.
    const users = await db.query('SELECT "authSubject" FROM "User"');
    assert.deepEqual(
      users.rows.map((r) => r.authSubject),
      [subject],
    );
  });
});

test("unverified members cannot make student-only mutations", async () => {
  await transaction(async (db) => {
    const listing = await demoListing(db);
    const subject = await account(db);
    await as(db, subject);
    await rpc(db, "upsert_profile", ["Pending"]);
    // No membership at all: the listing is not visible.
    await rejects(
      db,
      () => rpc(db, "report_listing", [listing, "Looks unsafe"]),
      code("NOT_FOUND"),
    );
    // Membership exists but is not verified (e.g. verification revoked).
    await asOwner(db);
    await db.query(
      `INSERT INTO "Membership" (id, "campusId", "userId", role)
       SELECT gen_random_uuid(), $1, id, 'STUDENT' FROM "User" WHERE "authSubject" = $2`,
      [DEMO_CAMPUS, subject],
    );
    await as(db, subject);
    await rejects(
      db,
      () => rpc(db, "report_listing", [listing, "Looks unsafe"]),
      code("FORBIDDEN"),
    );
    const visible = await db.query('SELECT count(*)::int AS n FROM "Listing"');
    assert.equal(visible.rows[0].n, 0);
  });
});

test("a verified student can report a listing and read only their own report", async () => {
  await transaction(async (db) => {
    const listing = await demoListing(db);
    const reporter = await verifiedStudent(db, "Reporter");
    const bystander = await verifiedStudent(db, "Bystander");
    await as(db, reporter.subject);
    await rejects(
      db,
      () => rpc(db, "report_listing", [listing, "x"]),
      code("VALIDATION_ERROR"),
    );
    const report = await rpc(db, "report_listing", [listing, "Duplicate post"]);
    const own = await db.query('SELECT id FROM "Report" WHERE id = $1', [
      report.report_id,
    ]);
    assert.equal(own.rowCount, 1);
    await as(db, bystander.subject);
    const other = await db.query('SELECT id FROM "Report" WHERE id = $1', [
      report.report_id,
    ]);
    assert.equal(other.rowCount, 0);
  });
});

test("students cannot grant themselves staff authority", async () => {
  await transaction(async (db) => {
    const student = await verifiedStudent(db);
    await as(db, student.subject);
    await rejects(
      db,
      () => rpc(db, "assign_staff", [student.memberId, UNION]),
      code("FORBIDDEN"),
    );
    await rejects(
      db,
      () =>
        db.query(`UPDATE "Membership" SET role = 'STAFF' WHERE id = $1`, [
          student.memberId,
        ]),
      { code: "42501" },
    );
    await rejects(
      db,
      () =>
        db.query(
          `INSERT INTO "StaffAssignment" (id, "campusId", "membershipId", "locationId") VALUES ($1, $2, $3, $4)`,
          [randomUUID(), DEMO_CAMPUS, student.memberId, UNION],
        ),
      { code: "42501" },
    );
    const session = await rpc(db, "my_session");
    assert.equal(session.memberships[0].role, "student");
    assert.deepEqual(session.memberships[0].staff_location_ids, []);
  });
});

test("staff authority is granted by a campus admin and scoped to one location", async () => {
  await transaction(async (db) => {
    const admin = await verifiedStudent(db, "Campus admin");
    await db.query(`UPDATE "Membership" SET role = 'ADMIN' WHERE id = $1`, [
      admin.memberId,
    ]);
    const volunteer = await verifiedStudent(db, "Volunteer");
    const outsider = await otherCampus(db);

    await as(db, admin.subject);
    await rpc(db, "assign_staff", [volunteer.memberId, UNION]);
    // Other-campus targets and locations look like missing objects.
    await rejects(
      db,
      () => rpc(db, "assign_staff", [outsider.member, UNION]),
      code("NOT_FOUND"),
    );
    await rejects(
      db,
      () => rpc(db, "assign_staff", [volunteer.memberId, outsider.location]),
      code("NOT_FOUND"),
    );

    await as(db, volunteer.subject);
    const session = await rpc(db, "my_session");
    assert.equal(session.memberships[0].role, "staff");
    assert.deepEqual(session.memberships[0].staff_location_ids, [UNION]);
    const check = await db.query(
      "SELECT app.is_location_staff($1) AS union_desk, app.is_location_staff($2) AS mail_center, app.is_location_staff($3) AS other_campus",
      [UNION, MAIL_CENTER, outsider.location],
    );
    assert.deepEqual(check.rows[0], {
      union_desk: true,
      mail_center: false,
      other_campus: false,
    });
    // A staff member is not an admin and cannot extend their own authority.
    await rejects(
      db,
      () => rpc(db, "assign_staff", [volunteer.memberId, MAIL_CENTER]),
      code("FORBIDDEN"),
    );

    await as(db, admin.subject);
    await rpc(db, "revoke_staff", [volunteer.memberId, UNION]);
    await as(db, volunteer.subject);
    const revoked = await db.query("SELECT app.is_location_staff($1) AS ok", [
      UNION,
    ]);
    assert.equal(revoked.rows[0].ok, false);
  });
});

test("staff-only rows are visible only at the assigned location", async () => {
  await transaction(async (db) => {
    const admin = await verifiedStudent(db, "Campus admin");
    await db.query(`UPDATE "Membership" SET role = 'ADMIN' WHERE id = $1`, [
      admin.memberId,
    ]);
    const volunteer = await verifiedStudent(db, "Volunteer");
    const student = await verifiedStudent(db, "Student");
    const { rows } = await db.query(
      `SELECT l."locationId" FROM "InventoryEvent" e JOIN "StockLot" l ON l.id = e."stockLotId" LIMIT 1`,
    );
    const eventLocation = rows[0].locationId as string;
    const elsewhere = eventLocation === UNION ? MAIL_CENTER : UNION;

    const count = async (subject: string) => {
      await as(db, subject);
      const r = await db.query(
        `SELECT count(*)::int AS n FROM "InventoryEvent" e JOIN "StockLot" l ON l.id = e."stockLotId" WHERE l."locationId" = $1`,
        [eventLocation],
      );
      return r.rows[0].n as number;
    };
    assert.equal(await count(student.subject), 0);
    await as(db, admin.subject);
    await rpc(db, "assign_staff", [volunteer.memberId, elsewhere]);
    assert.equal(await count(volunteer.subject), 0);
    await as(db, admin.subject);
    await rpc(db, "assign_staff", [volunteer.memberId, eventLocation]);
    assert.ok((await count(volunteer.subject)) > 0);
  });
});

test("other campuses and other people's conversations are not readable", async () => {
  await transaction(async (db) => {
    const outsider = await otherCampus(db);
    const alice = await verifiedStudent(db, "Alice");
    const bob = await verifiedStudent(db, "Bob");
    const carol = await verifiedStudent(db, "Carol");
    const listing = await demoListing(db);
    const conversation = randomUUID();
    await db.query(
      `INSERT INTO "Conversation" (id, "campusId", "listingId") VALUES ($1, $2, $3)`,
      [conversation, DEMO_CAMPUS, listing],
    );
    for (const member of [alice.memberId, bob.memberId])
      await db.query(
        `INSERT INTO "ConversationParticipant" ("conversationId", "memberId", "campusId") VALUES ($1, $2, $3)`,
        [conversation, member, DEMO_CAMPUS],
      );
    await db.query(
      `INSERT INTO "Message" (id, "conversationId", "senderId", body) VALUES ($1, $2, $3, 'Is it still sealed?')`,
      [randomUUID(), conversation, alice.memberId],
    );

    const messages = async (subject: string) => {
      await as(db, subject);
      const r = await db.query(
        'SELECT count(*)::int AS n FROM "Message" WHERE "conversationId" = $1',
        [conversation],
      );
      return r.rows[0].n as number;
    };
    assert.equal(await messages(bob.subject), 1);
    assert.equal(await messages(carol.subject), 0);
    const participants = await db.query(
      'SELECT count(*)::int AS n FROM "ConversationParticipant"',
    );
    assert.equal(participants.rows[0].n, 0);

    await as(db, alice.subject);
    const foreign = await db.query('SELECT id FROM "Listing" WHERE id = $1', [
      outsider.listing,
    ]);
    assert.equal(foreign.rowCount, 0);
    await rejects(
      db,
      () => rpc(db, "report_listing", [outsider.listing, "Not from here"]),
      code("NOT_FOUND"),
    );
    const own = await db.query(
      'SELECT count(*)::int AS n FROM "Listing" WHERE "campusId" = $1',
      [DEMO_CAMPUS],
    );
    assert.ok(own.rows[0].n > 0);
  });
});

test("a profile cannot take over another account's email record", async () => {
  await transaction(async (db) => {
    const subject = await account(db);
    const { rows } = await db.query(
      "SELECT email FROM auth.users WHERE id = $1",
      [subject],
    );
    await db.query(
      `INSERT INTO "User" (id, email, "displayName") VALUES ($1, $2, 'Existing record')`,
      [randomUUID(), rows[0].email],
    );
    await as(db, subject);
    await rejects(
      db,
      () => rpc(db, "upsert_profile", ["Intruder"]),
      code("INVALID_STATE"),
    );
  });
});

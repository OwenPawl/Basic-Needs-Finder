import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { seedId } from "../prisma/demo-data";
const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Database tests require DATABASE_URL pointing to a dedicated database whose name ends in _test. Run migrations and seed first.",
  );
async function transaction(check: (client: pg.Client) => Promise<void>) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await check(client);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}
test("database rejects oversubscribed and negative inventory counters", async () => {
  for (const [onHand, reserved] of [
    [1, 2],
    [-1, 0],
    [1, -1],
  ]) {
    await transaction(async (client) => {
      await assert.rejects(
        client.query(
          'UPDATE "StockLot" SET "onHand"=$1, reserved=$2 WHERE id=$3',
          [onHand, reserved, seedId(1100)],
        ),
        { code: "23514" },
      );
    });
  }
});
test("pledged stock cannot be made physically available without receipt", async () => {
  await transaction(async (client) => {
    await assert.rejects(
      client.query('UPDATE "StockLot" SET "onHand"=1 WHERE id=$1', [
        seedId(1102),
      ]),
      { code: "23514" },
    );
  });
});
test("cross-campus location references are rejected by the database", async () => {
  await transaction(async (client) => {
    const campusId = randomUUID(),
      locationId = randomUUID();
    await client.query(
      'INSERT INTO "Campus" (id,slug,name,"emailDomains","isDemo") VALUES ($1,$2,$3,$4,true)',
      [campusId, campusId, "Other demo campus", []],
    );
    await client.query(
      'INSERT INTO "Location" (id,"campusId",name,building,hours,instructions) VALUES ($1,$2,$3,$4,$5,$6)',
      [locationId, campusId, "Other location", "Example", "Example", "Example"],
    );
    await assert.rejects(
      client.query('UPDATE "StockLot" SET "locationId"=$1 WHERE id=$2', [
        locationId,
        seedId(1100),
      ]),
      { code: "23503" },
    );
  });
});
test("row-level security denies data access before authenticated policies exist", async () => {
  await transaction(async (client) => {
    await client.query("CREATE ROLE bnf_foundation_test_reader NOLOGIN");
    await client.query(
      "GRANT USAGE ON SCHEMA public TO bnf_foundation_test_reader",
    );
    await client.query(
      "GRANT SELECT ON ALL TABLES IN SCHEMA public TO bnf_foundation_test_reader",
    );
    await client.query("SET LOCAL ROLE bnf_foundation_test_reader");
    for (const table of [
      "User",
      "Membership",
      "Listing",
      "Message",
      "Reservation",
    ]) {
      const result = await client.query(
        `SELECT count(*)::int AS count FROM "${table}"`,
      );
      assert.equal(result.rows[0].count, 0);
    }
  });
});

test("audit snapshots must agree with deltas and preserve stock invariants", async () => {
  await transaction(async (client) => {
    await assert.rejects(
      client.query(
        'UPDATE "InventoryEvent" SET "onHandBefore"=0,"onHandAfter"=99,"reservedBefore"=0,"reservedAfter"=0 WHERE "commandKey"=$1',
        ["demo-receipt-100"],
      ),
      { code: "23514" },
    );
  });
});
test("idempotency keys are unique for one actor but reusable by another", async () => {
  await transaction(async (client) => {
    const event = await client.query(
      'SELECT * FROM "InventoryEvent" WHERE "commandKey"=$1',
      ["demo-receipt-100"],
    );
    assert.equal(event.rowCount, 1);
    await client.query(
      'INSERT INTO "InventoryEvent" (id,"campusId","stockLotId","actorId",kind,"onHandDelta","reservedDelta",reason,"commandKey") VALUES ($1,$2,$3,$4,$5,0,0,$6,$7)',
      [
        randomUUID(),
        seedId(1),
        seedId(1100),
        seedId(22),
        "CORRECTION",
        "Test only",
        "demo-receipt-100",
      ],
    );
    await assert.rejects(
      client.query(
        'INSERT INTO "InventoryEvent" (id,"campusId","stockLotId","actorId",kind,"onHandDelta","reservedDelta",reason,"commandKey") VALUES ($1,$2,$3,$4,$5,0,0,$6,$7)',
        [
          randomUUID(),
          seedId(1),
          seedId(1100),
          seedId(23),
          "CORRECTION",
          "Test only",
          "demo-receipt-100",
        ],
      ),
      { code: "23505" },
    );
  });
});

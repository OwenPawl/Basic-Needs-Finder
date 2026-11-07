// Installs scripts/test-auth-shim.sql into a disposable *_test database on
// this machine (local or CI), before `prisma migrate deploy`. It refuses any
// other database; the SQL file repeats the checks inside PostgreSQL.
import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL to a local *_test database.");
const parsed = new URL(url);
const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
const localHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
if (!database.endsWith("_test"))
  throw new Error(
    `Refusing to install the test auth shim: database "${database}" does not end in _test.`,
  );
if (!localHosts.has(parsed.hostname))
  throw new Error(
    `Refusing to install the test auth shim on non-local host "${parsed.hostname}".`,
  );

const sql = readFileSync(
  new URL("./test-auth-shim.sql", import.meta.url),
  "utf8",
);
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  console.log(`Test auth shim installed in ${database}.`);
} finally {
  await client.end();
}

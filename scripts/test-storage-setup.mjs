// A minimal SQL test fixture, not a replacement for the Supabase Storage API.
import "dotenv/config";
import pg from "pg";
const url = process.env.DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  process.env.BNF_ALLOW_TEST_SHIMS !== "1"
)
  throw new Error(
    "Storage fixture requires *_test database and BNF_ALLOW_TEST_SHIMS=1. Never run against a hosted project.",
  );
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "postgres"].includes(host))
  throw new Error("Test storage fixture is restricted to local/CI PostgreSQL.");
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  const exists = await db.query(
    "SELECT to_regclass('storage.objects') AS object",
  );
  if (exists.rows[0].object)
    throw new Error(
      "Storage schema already exists. Do not replace managed Storage objects.",
    );
  await db.query(`CREATE SCHEMA storage;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean NOT NULL DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text NOT NULL REFERENCES storage.buckets(id),name text NOT NULL,owner_id text,metadata jsonb DEFAULT '{}'::jsonb,UNIQUE(bucket_id,name));
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA storage TO authenticated;
 GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;`);
  console.log("Created minimal Storage metadata fixture for SQL tests only.");
} finally {
  await db.end();
}

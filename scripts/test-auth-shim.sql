-- TEST DATABASES ONLY. Never run against Supabase or any shared database.
--
-- A minimal stand-in for the Supabase-managed auth objects that
-- prisma/migrations/*_student_auth depends on: the anon and authenticated
-- roles, auth.users (only the columns the app reads), and auth.uid(), which
-- reads the same JWT claim settings PostgREST sets. Tests switch to the
-- authenticated role and set request.jwt.claims themselves.
--
-- Because this auth.uid() trusts a session setting, it would let any caller
-- choose an identity. That is why it lives here, behind guards, and not in a
-- migration. Run it with `npm run db:test-auth-shim` before `npm run db:migrate`.

DO $$
BEGIN
  IF current_database() NOT LIKE '%\_test' THEN
    RAISE EXCEPTION 'test-auth-shim refused: database "%" does not end in _test', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('supabase_auth_admin', 'supabase_admin', 'service_role')) THEN
    RAISE EXCEPTION 'test-auth-shim refused: Supabase roles exist here; use the real auth schema';
  END IF;
  IF to_regclass('auth.users') IS NOT NULL
     AND coalesce(obj_description(to_regclass('auth.users'), 'pg_class'), '') <> 'bnf test auth shim' THEN
    RAISE EXCEPTION 'test-auth-shim refused: auth.users exists and is not the test stand-in';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  email_confirmed_at TIMESTAMPTZ
);
COMMENT ON TABLE auth.users IS 'bnf test auth shim';

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  ), '')::uuid
$$;
COMMENT ON FUNCTION auth.uid() IS 'bnf test auth shim';

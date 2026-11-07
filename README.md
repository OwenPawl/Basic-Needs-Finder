# Basic Needs Finder

Food and basic-needs support for Western Washington University students, on campus and around Bellingham.

[Open the resource finder](https://owenpawl.github.io/Basic-Needs-Finder/).

**Current status:** an anonymous public directory with 11 real WWU/Bellingham resources, search, location/type/service-day filters, provider details, directions, and a printable/downloadable resource plan. Each resource links to an official source with a checked date. No AI imagery, fabricated public inventory, student-data collection, location request, or analytics. Plan selections live in page memory and clear on reload.

The goods exchange at `/exchange/` implements offers, requests, owner edits, real photo uploads, and category/location/availability search. Offers remain pledged until staff confirms receipt. `/account/` implements verified campus sign-in. Reservations, staff receipt/pickup/correction/report views, and private listing conversations are implemented. The initial six migrations are installed in the hosted project; final API installation and email delivery are still pending. Full signed-in HTTP/browser verification is not yet complete. The PostgreSQL foundation and fictional test fixtures remain available for their implementation; those fixtures are not imported into the public directory.

## Run the preview

Use Node.js 24 and npm. No database or Supabase credentials are needed for the directory.

```bash
npm ci
npm run db:generate
npm run dev
```

Open http://127.0.0.1:3000. To test the exact GitHub Pages export:

```bash
npm run build:pages
npm run preview
```

Open http://127.0.0.1:3000/Basic-Needs-Finder/. The Pages base path is handled by the build script. The site contains no runtime Next.js server routes.

## Local PostgreSQL

Install/start Docker or Podman, then:

```bash
cp .env.example .env
npm run db:start
npm run db:migrate
npm run db:seed
npm run db:export-demo
```

Migrations from `student-auth` onward depend on Supabase's auth objects (`auth.users`, `auth.uid()`, the `anon`/`authenticated` roles), so `db:migrate` stops with a clear error on plain PostgreSQL. For local work either use the disposable `_test` database below, where `npm run db:test-auth-shim` installs a test-only stand-in before migrating, or run the Supabase CLI's local stack for the real auth schema. The stand-in refuses any database whose name doesn't end in `_test` and any non-local host.

The helper binds PostgreSQL 17 to localhost:55432 and retains a named volume. `npm run db:stop` stops the container without deleting data. Alternatively set DATABASE_URL to your own PostgreSQL development database. Seed records are fictional and reruns preserve existing rows. Remote seeding requires an intentional ALLOW_DEMO_SEED=1. `db:export-demo` refreshes the internal catalog fixture only; the public page uses `src/data/wwu-resources.json`. The fixture exporter never exports users or messages.

## Verify

```bash
npm run typecheck
npm test
npm run build:pages
```

Database tests need a dedicated database whose name ends in `_test`. For the local container (replace `podman` with `docker` if needed):

```bash
podman exec basic-needs-finder-postgres createdb -U campus basic_needs_test
export DATABASE_URL='postgresql://campus:campus_local_only@127.0.0.1:55432/basic_needs_test?schema=public'
npm run db:test-auth-shim
npm run db:migrate
npm run db:seed
npm run test:db
```

Create the test database only once. Tests roll back their transactions. They validate real PostgreSQL constraints and default-deny RLS; transactional reserve/cancel/pickup races belong to inventory-core. CI creates its own disposable database and runs these checks before Pages deployment.

## Hosting and team contracts

- [Resource provenance, scope and verification](docs/WWU_RESOURCES.md)
- [GitHub Pages and free Supabase deployment](docs/DEPLOYMENT.md)
- [Actual schema/API boundary and task ownership](docs/API_CONTRACT.md)
- [Foundation delivery and validation](docs/FOUNDATION.md)
- [Original plan](docs/PROJECT_PLAN.txt), [MVP](docs/MVP.md), [domain invariants](docs/DOMAIN.md), [team tasks](docs/TEAM_TASKS.md)
- [Agent contribution instructions](AGENTS.md)

Claim work on the mesh, use a `codex/` task branch, and submit pinned evidence for independent review. Agents use their owners' GitHub authentication. Never commit mesh tokens, environment secrets, or real student data. An offered item becomes reservable only after staff confirms receipt; available stock must be derived from physical inventory and active holds.

## Goods exchange setup

Apply production migrations to Supabase, then run `scripts/wwu-campus.sql` for the real WWU campus and seven user-selected residential mail desks. It creates no users, staff assignments, listings, or inventory. Do not run the demo seed against the live project. Desk locations follow WWU Housing; this independent project does not imply university approval of donation handling. Set the browser publishable key and URL as documented in `docs/AUTH.md`. Never put a secret or service-role key in a frontend.

For SQL tests only, run `BNF_ALLOW_TEST_SHIMS=1 npm run db:test-storage` after the guarded auth shim and before migrations. Both fixtures are restricted to local `_test` databases. The Storage fixture validates metadata/RLS, not the real upload HTTP service.

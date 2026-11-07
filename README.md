# Basic Needs Finder

Food and basic-needs support for Western Washington University students, on campus and around Bellingham.

[Open the resource finder](https://owenpawl.github.io/Basic-Needs-Finder/).

**Current status:** an anonymous public directory with 11 real WWU/Bellingham resources, search, location/type/service-day filters, provider details, directions, and a printable/downloadable resource plan. Each resource links to an official source with a checked date. No AI imagery, fabricated public inventory, student-data collection, location request, or analytics. Plan selections live in page memory and clear on reload.

Live student accounts, shared inventory, messaging, reservations, and staff operations are separate team tasks and are not connected to the hosted Supabase project yet. The PostgreSQL foundation and fictional test fixtures remain available for their implementation; those fixtures are not imported into the public directory.

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

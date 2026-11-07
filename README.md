# Basic Needs Finder

A campus resource-sharing platform for free essentials, designated pickup points, and community support.

**Current status:** runnable application foundation with an interactive, clearly labeled fictional catalog. Search, categories, pickup-location filters, offers/requests, availability, item details, and food information work in the preview. PostgreSQL schema, migrations, fictional seed data, and constraint tests are included. Live accounts, messaging, reservations, staff operations, and a connected Supabase backend are separate team tasks; they are not implemented yet.

## Run the preview

Use Node.js 24 and npm. No database is needed to view the committed demo catalog.

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

The helper binds PostgreSQL 17 to localhost:55432 and retains a named volume. `npm run db:stop` stops the container without deleting data. Alternatively set DATABASE_URL to your own PostgreSQL development database. Seed records are fictional and reruns preserve existing rows. Remote seeding requires an intentional ALLOW_DEMO_SEED=1. Static export is limited to the demo campus and explicitly selected public fields; it never exports users or messages.

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
npm run db:migrate
npm run db:seed
npm run test:db
```

Create the test database only once. Tests roll back their transactions. They validate real PostgreSQL constraints and default-deny RLS; transactional reserve/cancel/pickup races belong to inventory-core. CI creates its own disposable database and runs these checks before Pages deployment.

## Hosting and team contracts

- [GitHub Pages and free Supabase deployment](docs/DEPLOYMENT.md)
- [Actual schema/API boundary and task ownership](docs/API_CONTRACT.md)
- [Foundation delivery and validation](docs/FOUNDATION.md)
- [Original plan](docs/PROJECT_PLAN.txt), [MVP](docs/MVP.md), [domain invariants](docs/DOMAIN.md), [team tasks](docs/TEAM_TASKS.md)
- [Agent contribution instructions](AGENTS.md)

Claim work on the mesh, use a `codex/` task branch, and submit pinned evidence for independent review. Agents use their owners' GitHub authentication. Never commit mesh tokens, environment secrets, or real student data. An offered item becomes reservable only after staff confirms receipt; available stock must be derived from physical inventory and active holds.

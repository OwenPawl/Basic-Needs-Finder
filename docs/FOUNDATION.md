# Foundation delivery

Task: app-foundation. Branch: codex/app-foundation. This is implementation evidence for independent review, not a claim of completed live MVP integration.

## Delivered

- Static Next.js/React/TypeScript/Tailwind application with GitHub Pages base-path handling and original SVG illustrations.
- Interactive fictional resource catalog: text/category/location/type/availability filters, sort, empty state, details dialog, food metadata, and pickup-location cards.
- PostgreSQL/Prisma campus, membership, staff assignment, location, listing, batch food, stock, reservation, audit, conversation, message, and report records.
- Three append-only migrations with stock constraints, campus-consistent foreign keys, actor-scoped idempotency uniqueness, timezone-aware timestamps, and default-deny row-level security.
- Repeatable fictional seed; curated static export excludes private records. Existing seed rows are preserved on reruns.
- API naming, identity, inventory/error, routing, and team ownership contract coordinated with Ivana's and Hayden's mesh notes.
- CI database validation/build and Pages deployment workflow; local PostgreSQL and static preview scripts; setup/hosting documentation.

## Validation

Local Node 24 / PostgreSQL 17: `npm run db:generate`, all migrations, repeat seed, and demo export succeed. `npm run typecheck`, seven catalog unit checks, seven real PostgreSQL tests, and `npm run build:pages` pass.

Database tests cover negative/oversubscribed counters, pledged-stock receipt boundary, cross-campus foreign keys, RLS default deny, audit delta/snapshot consistency, actor-scoped idempotency uniqueness, and required audit snapshots/hashes. Tests run inside rolled-back transactions on a dedicated `_test` database. These do not substitute for inventory-core's concurrent mutation tests.

The exported page and a prefixed SVG asset return HTTP 200. Browser checks verified empty-search recovery, the four received/available offers, location filtering that excludes pending/fully reserved stock, food allergen-unknown copy, dialog autofocus, Escape dismissal, and focus return to the triggering card. Visual inspection of the exported page at 320px and 390px iframe widths confirmed reflowing navigation, readable filters, and a single-column card layout. Category controls intentionally scroll horizontally.

## Remaining work and review

Accounts, university verification, real uploads, private messaging, inventory RPCs, reservations, staff actions, and production RLS policies are not implemented. No hosted Supabase database was changed. The preview is clearly labeled with fictional content and cannot make real reservations. No real student data or secrets are committed.

Audit snapshot/hash fields are now NOT NULL following Hayden's independent review; migration three repairs only the seven exact original fictional fixture events. Hold duration (proposed 24 hours), per-student limits, real campus locations, and university verification domains need campus policy decisions. Full API agreement and independent acceptance belong to the reviewer. GitHub Pages must be enabled in repository settings before the deployment job can succeed.

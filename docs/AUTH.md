# Student auth and authorization

Task: `student-auth`. Branch: `codex/student-auth`. Migration: `prisma/migrations/202611070004_student_auth`. Contract types: `src/lib/session.ts`.

This delivers authentication for the GitHub Pages + Supabase Free design: verified campus membership, location-scoped staff authority, campus-aware row-level security, a session contract, and the static `/account/` page (email one-time-code sign-in, profile name, campus verification, profile/history shell, sign-out). `src/lib/supabase.ts` exposes `getSupabaseClient()` for other tasks.

## How a student becomes verified

1. On `/account/` the student enters their university email. `signInWithOtp` sends a 6-digit code, and `verifyOtp({ type: "email" })` signs them in. Entering the code also confirms the email address.
2. After confirming, the client calls `upsert_profile(display_name)`. This creates the `User` row linked to `auth.uid()`. The email is copied from the authenticated account, never from client input, and stays private.
3. The client calls `verify_campus_membership(campus_slug)`. The database checks that `auth.users.email_confirmed_at` is set and that the email's domain exactly matches one of `Campus.emailDomains`. It then creates or verifies a `STUDENT` membership. It never grants or changes a staff or admin role.
4. `my_session()` returns the session contract: user id, display name, `email_confirmed`, and memberships with role, verification, and staff location ids. It contains **no email or contact data**.

`sessionStage()` in `src/lib/session.ts` maps a session to the next onboarding step: `needs-profile`, `needs-email-confirmation`, `needs-campus-verification`, or `verified`.

## Staff authority

- Staff authority is per location: a verified `STAFF`/`ADMIN` membership in the location's campus **plus** a `StaffAssignment` row for that exact location.
- Only a verified campus `ADMIN` can call `assign_staff(membership_id, location_id)` or `revoke_staff(...)`. Targets and locations in another campus return `NOT_FOUND`.
- Students have no write access to `Membership` or `StaffAssignment`. Direct `UPDATE`/`INSERT` fails with a permission error, so roles can't be self-assigned from the browser.
- **Bootstrapping the first admin** is a trusted operator step. Run it in the Supabase SQL editor (as the project owner) after that person has verified, for example: `UPDATE "Membership" SET role = 'ADMIN' WHERE id = '<membership id>';`. Never do this from client code, client metadata, or a public key.

## Row-level security

- `anon` has no table access and cannot call the RPCs. The static demo catalog serves anonymous browsing.
- `authenticated` can only `SELECT`, and only through these policies. There are no browser `INSERT`/`UPDATE`/`DELETE` policies: every mutation goes through a `SECURITY DEFINER` RPC that checks authority itself (as `note:inventory-on-supabase` requires).

| Table | Readable by |
| --- | --- |
| Campus, Category | Any signed-in user |
| User | Only your own row |
| Membership | Your own memberships; campus admins see their campus |
| StaffAssignment | Your own; campus admins |
| Location, StockLot, StockFoodDetails | Verified members of that campus |
| Listing, FoodDetails | Verified members of that campus (removed listings only by their author) |
| Reservation | The reserving student; staff assigned to the lot's location |
| InventoryEvent | Staff assigned to the lot's location |
| Conversation, ConversationParticipant, Message | Conversation participants only |
| Report | The reporter; staff assigned to the listing's location |

Other-campus objects are indistinguishable from missing ones (`NOT_FOUND`), as `API_CONTRACT.md` requires.

## Helpers for other tasks

Use these inside your own `SECURITY DEFINER` RPCs (with `SET search_path = ''`) instead of writing new role checks:

| Helper | Returns / raises |
| --- | --- |
| `app.require_verified_member(campus_id)` | Caller's membership id. Raises `UNAUTHENTICATED` without a session, `FORBIDDEN` without verified membership |
| `app.require_location_staff(location_id)` | Caller's membership id. Raises `UNAUTHENTICATED`, `NOT_FOUND` (other campus or unknown), or `FORBIDDEN` (no assignment) |
| `app.member_id(campus_id)`, `app.is_verified_member`, `app.is_campus_admin`, `app.is_location_staff`, `app.is_conversation_participant` | Booleans and ids for policies |
| `app.fail(code, detail)` | Raises an `API_CONTRACT.md` error code. PostgREST returns it in `error.message` |

`report_listing(listing_id, reason)` is included as the reference example of a student-only mutation: unverified members get `FORBIDDEN`, and other campuses get `NOT_FOUND`.

The `app` schema isn't exposed by Supabase's Data API, so these helpers can't be called over HTTP.

When a later migration adds a table in `public`, enable RLS on it and revoke `anon`/`authenticated` privileges explicitly. Supabase's default privileges would otherwise grant them.

## Supabase setup for Owen (not applied yet)

These steps need the project owner in the Supabase dashboard; nothing has been changed on the hosted project.

1. Apply the migrations in order (`prisma migrate deploy` with the project's database URL, from a trusted machine). Do **not** run `db:test-auth-shim` there: it refuses non-`_test` databases and Supabase roles anyway.
2. Auth → Providers → Email: enabled, **Confirm email** on.
3. Auth → Email Templates → *Magic Link* (also used for OTP sign-in): include the code, e.g. `<p>Your Basic Needs Finder code is <strong>{{ .Token }}</strong></p>`. Without `{{ .Token }}` Supabase sends only a link, and the static page has no link handler.
4. Auth → URL Configuration: Site URL `https://owenpawl.github.io/Basic-Needs-Finder/`.
5. Build configuration: set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the publishable/anon key, never the service-role key) for `npm run build:pages`. Without them `/account/` shows “Accounts are coming soon”.
6. Add the real campus row with `emailDomains = {wwu.edu}` only after campus approval, and grant the first admin with the operator SQL above.

## Development vs production email

- **Production (hosted Supabase):** Auth → Providers → Email must have **Confirm email enabled**. Don't enable auto-confirm. Add the GitHub Pages URL (`https://owenpawl.github.io/Basic-Needs-Finder/`) to the Site URL and redirect allow-list. Each real campus's `emailDomains` must list only its real university domains, and only after campus approval.
- **Development:** use the Supabase CLI's local stack, which catches all mail in its local inbox (Inbucket/Mailpit). Never point a development project at real student addresses.
- **Fictional demo campus:** its only domain is `students.example.invalid`. The `.invalid` top-level domain can never receive mail, so nobody can self-verify into the demo campus on a hosted project. Demo memberships exist only through the fictional seed.
- **Local PostgreSQL and CI:** the migration never creates auth objects; it stops with a clear error if `anon`/`authenticated`, `auth.users` or `auth.uid()` are missing. For disposable test databases, `npm run db:test-auth-shim` installs a stand-in from `scripts/test-auth-shim.sql` **before** `db:migrate` (CI does this). It refuses any database whose name doesn't end in `_test`, any non-local host, and any database with Supabase roles. The stand-in `auth.uid()` trusts a session setting, which is exactly why it must never reach a real database. Tests simulate a signed-in browser by switching to the `authenticated` role with JWT claims, as PostgREST does.

## Tests

`npm run test:db` now also runs `tests/auth.test.ts`: 12 checks against real PostgreSQL, each in a rolled-back transaction. They cover:
- no session and `anon` access;
- unconfirmed email, wrong domain, and unknown campus;
- a session that contains no contact data;
- unverified members blocked from a student-only mutation;
- report visibility;
- student self-promotion through the RPC, direct `UPDATE`, and direct `INSERT`;
- admin-granted staff authority scoped to one location, plus revocation;
- staff-only audit rows;
- cross-campus listings and non-participant messages;
- profile takeover by email.
- an operator-created, unverified STAFF membership not being activated by the email check;
- `_prisma_migrations` closed to browser roles, and new tables not granted to them.

`tests/session.unit.test.ts` covers the TypeScript contract helpers.

## Not done yet

- **Not exercised end to end:** real Supabase email delivery, code entry, profile, campus verification and sign-out against a hosted or local Supabase stack. The page was checked in a browser for the “not connected” state and the send-code error path only; the database side is covered by `tests/auth.test.ts` with the test stand-in, which does not prove the hosted flow.
- Applying the migration and the setup steps above to the hosted project (needs the owner).
- Rate limiting and abuse controls beyond what Supabase Auth provides.
- Future migrations still need RLS and explicit grants on each new table. The default-privilege revoke covers objects created by the migration role; on plain PostgreSQL that test passes trivially because nothing is granted by default.

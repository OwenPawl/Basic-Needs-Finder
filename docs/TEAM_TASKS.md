# Team tasks

These tasks are prepared for the mesh board. They are not assigned or claimed. Estimates are planning placeholders, not promises; adjust them after the team agrees on scope.

Three starting tasks can proceed in parallel: **app-foundation**, **ui-foundation**, and **inventory-test-cases**. Their owners should agree on the data/interface contract before dependent implementations begin.

| Task | Depends on | Deliverable |
| --- | --- | --- |
| `app-foundation` | None | Runnable starter, migration/seed commands, environment example without secrets, and agreed schema/API types. |
| `ui-foundation` | None | Screen/flow specifications, shared UI conventions, and example payloads for student and staff views. |
| `inventory-test-cases` | None | Reviewable inventory test matrix and concurrency-test specification. |
| `student-auth` | `app-foundation` | Working authentication, verification, authorization helpers, and representative access-control tests. |
| `inventory-core` | `app-foundation`, `inventory-test-cases` | Transactional inventory service, audit records, and executable PostgreSQL concurrency/idempotency tests. |
| `listings-discovery` | `app-foundation`, `ui-foundation`, `student-auth` | Functional student listings/discovery/profile flows with persistent data and validation checks. |
| `reservation-flow` | `student-auth`, `inventory-core`, `listings-discovery` | Working end-to-end student reservation/cancellation flow and integration checks. |
| `staff-console` | `student-auth`, `inventory-core`, `ui-foundation` | Functional staff console, moderation/reporting entry points, and scoped authorization checks. |
| `private-messaging` | `student-auth`, `listings-discovery` | Working inbox/conversations, privacy checks, and a two-user demonstration. |
| `demo-integration` | `reservation-flow`, `staff-console`, `private-messaging` | Reproducible working MVP demo, setup documentation, test results, and pinned integration evidence. |

All ten tasks contribute to the first demonstration. Carpooling and expanded notifications are follow-up work. Task ownership is chosen by the team, with one live claim per participant by default.

## Acceptance criteria

### app-foundation — Scaffold the app and agree on the data/API contract

Inspect the empty repository, confirm the proposed stack with the team, scaffold the application, and publish the initial campus-aware schema, migrations, seed approach, and shared interface contract. Coordinate auth boundaries with the authentication task.

**Accept when:** A clean clone starts with documented environment setup; PostgreSQL migrations and fictional seeds run; a minimal application page renders; campus/location/category/listing/stock/reservation/conversation records and authorization boundaries are documented; API/types contracts are agreed with the team.

**Interface/handoff:** Own the application skeleton, database migrations, package configuration, and shared contracts. UI work can proceed using the fixtures documented by ui-foundation.

### ui-foundation — Define accessible student and staff screens

Create the student browse, listing detail/create, profile/history, reservation, inbox, and staff-inventory flow. Specify mobile layouts, form labels, empty/error/loading states, and sample data matching the proposed domain contract. Coordinate shared component ownership with the app foundation task.

**Accept when:** A teammate can follow the complete offer → receipt → reservation → pickup flow from the screen specifications; offers/requests/pending/reserved/available states are visibly distinct; keyboard/focus/form-label requirements and narrow-screen behavior are recorded; fixtures contain fictional data.

**Interface/handoff:** Produce interface/fixture specifications independently; wire functional UI in the implementation tasks after the shared contract is accepted.

### inventory-test-cases — Specify inventory transitions and race-condition checks

Turn the domain invariants into explicit test cases and fixtures covering pledges, receipts, reservations, cancellation, expiry, pickup, correction, and unauthorized operations. Define how independent database clients race for the last item.

**Accept when:** Expected stock/hold/reservation values are written for every transition; duplicate requests, concurrent reserve/cancel/expiry/pickup, and removal of unsafe stock have expected outcomes; test fixtures distinguish pledged from received items; the concurrency check requires exactly one successful reservation for one available item.

**Interface/handoff:** Provide test vectors and expected outcomes before implementation; inventory-core implements executable database tests from them.

### student-auth — Implement verified student sessions and staff permissions

Implement sign-up/sign-in, configured university-domain verification, campus membership, and location-scoped staff authorization. Expose a session contract for other tasks and a profile/history shell. Keep personal contact data private.

**Accept when:** Unverified users cannot make student-only mutations; students cannot self-assign staff roles; staff authority is checked at the relevant campus/location; unauthorized object access is rejected server-side; sign-in/out and verification are exercised; development email handling is clearly separated from production.

**Interface/handoff:** Own session/membership and server authorization helpers; other features consume these rather than inventing role checks.

### inventory-core — Implement transactional stock and reservations

Implement receipt, reserve, cancellation, expiry, pickup, and correction transactions. Use conditional updates or locking to preserve physical stock and hold counts. Include auditable events and idempotent state transitions. Domain service authorization context will be supplied by student-auth at route integration.

**Accept when:** Database-backed tests pass for all specified transitions; simultaneous reservations cannot oversell; duplicate receipts and pickup commands change inventory once; cancel/expiry release holds once; expired holds do not permanently block stock; quantities remain nonnegative and campus/location boundaries are enforced.

**Interface/handoff:** Own stock/reservation service and inventory schema extensions coordinated with foundation. Export typed operations for reservation-flow and staff-console; no unauthenticated mutation routes.

### listings-discovery — Build offers, requests, profiles, and discovery

Implement persistent offers and requests, category/location search, image handling, listing responses, student profiles/history, and the view of currently available pickup inventory. Enforce the supplied food metadata and sealed shelf-stable restriction when accepting food.

**Accept when:** A verified student can create/edit their own listing; both post types are searchable and filterable; pending donations are never labeled available; invalid data and unauthorized edits fail server-side; food rules and photo requirement are validated; mobile forms and empty/error states work; public responses do not expose contact data.

**Interface/handoff:** Consume auth and inventory contracts. Coordinate private response entry with messaging; quantity shown as available comes from confirmed stock, not the listing pledge.

### reservation-flow — Connect student reservations and collection instructions

Connect available inventory to reserve/cancel actions, reservation status/history, expiry feedback, and collection instructions. Handle contention by showing the current result and availability.

**Accept when:** A student reserves only confirmed stock, sees location/instructions/expiry, and can cancel their own active hold; insufficient-stock and expired-reservation errors are clear; repeat clicks cannot duplicate reservations; inventory updates persist across sessions; other users cannot access or cancel the reservation.

**Interface/handoff:** Use inventory-core transactions and student-auth session helpers. UI must not maintain a separate stock counter.

### staff-console — Build staff receipt, pickup, moderation, and inventory views

Implement location-scoped staff receipt/pickup confirmation, inventory views/corrections, location management, listing/report moderation, food removal, and basic counts for available items, requests, and completed exchanges.

**Accept when:** Authorized staff can confirm real receipt/pickup and see inventory change; students and other-location staff cannot perform those operations; correction reasons and actors are recorded; unsafe/expired food is unavailable; reports and listing removal are reviewable; summary counts use persisted data.

**Interface/handoff:** Consume shared authorization and inventory transactions. Do not implement a second receipt/pickup path with different rules.

### private-messaging — Implement private listing conversations

Implement persistent listing conversations and a basic inbox so students can respond to offers or requests without publishing contact information. Include understandable send/loading/error states.

**Accept when:** Two verified participants can start and continue a listing conversation; unrelated users cannot read or send to it; messages persist across sign-in sessions; public listing/profile payloads exclude private messages and contact details; server validation and mobile usability are checked.

**Interface/handoff:** Use the shared session and conversation contract. Polling is acceptable for the MVP; advanced delivery notifications follow later.

### demo-integration — Integrate and verify the complete campus exchange

Integrate reviewed contributions, run the full MVP demonstration, verify the real database concurrency checks, and finish clean-clone setup and test instructions. Record known limitations honestly.

**Accept when:** The full script in docs/MVP.md passes against one recorded integration commit; clean-clone install/environment/database/seed/run/test instructions work; desktop and narrow-screen flows are checked; no credentials or real student data are committed; reviewed, integrated, and demo-verified stages each have actual evidence.

**Interface/handoff:** Integrate reviewed branches after coordinating owners. Publish the exact integration commit and checks; do not count the planning files as implemented features.

## How to use the board

1. Confirm your participant and agent delegation in the mesh.
2. Pick an available task and inspect its packet, dependencies, and interface.
3. Publish a claim before making shared changes. Work in a separate branch.
4. Checkpoint with the branch, verified facts, questions, and next action.
5. Submit an immutable commit and reproducible verification for another participant to review.
6. Record integration and demo verification only after they have happened.

docs/TASKS.json carries the same draft payloads for board setup. Live claims, reviews, and current status belong in the private mesh ledger. Repository access must be configured separately.

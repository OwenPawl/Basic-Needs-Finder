# Foundation contract v1

This document defines the interface for the remaining team tasks. The static catalog is implemented; the authenticated RPCs below are not yet implemented. GitHub Pages serves static files. Supabase Free is the target for Auth, PostgreSQL, Storage, and transactional RPCs.

## Identity and access

Supabase `auth.uid()` maps to `User.authSubject`. An authenticated session alone does not grant a campus membership. University-domain verification must create/verify `Membership` server-side. Staff membership and per-location `StaffAssignment` are granted by authorized staff, never from editable client metadata. Read access to messages requires conversation participation. Return `NOT_FOUND` for object IDs outside the caller's campus. Public DTOs omit email, contact information, private messages, and audit actors.

All tables currently have row-level security enabled with no browser policies: access is denied by default. The auth task must add tested, campus-aware policies and RPC authorization before a publishable Supabase key can expose live data. PostgreSQL owner credentials are for trusted migrations only. Service-role keys never belong in the frontend or GitHub Pages.

## API naming and stock

Wire DTOs use snake_case and lowercase enum strings. Prisma uses camelCase and uppercase enums internally; map explicitly at the backend boundary. The static `src/data/catalog.json` is a separate, versioned demo view model with camelCase fields, not a live API response.

| API field | Prisma field |
| --- | --- |
| lot_id | StockLot.id / Reservation.stockLotId |
| pledged_quantity | StockLot.pledged |
| on_hand | StockLot.onHand |
| reserved | StockLot.reserved |
| available | derived: received lot only, onHand - reserved |
| student_id | Reservation.memberId (campus membership ID) |
| qty | Reservation.quantity |
| expires_at | Reservation.expiresAt (timestamptz) |
| idempotency_key | InventoryEvent.commandKey / Reservation.idempotencyKey |

Stock states: pledged, received, removed. Reservation states: active, completed, cancelled, expired. A fully reserved received lot remains `received`; availability is zero. API operations derive campus, actor, and server time from the verified session rather than trusting request fields.

Food metadata belongs to each `StockFoodDetails` batch: `photo`, `date_label`, `best_by`, `package_status` (sealed/opened maps to `opened`), `shelf_stable`, `storage`, and `allergens` with an explicit unknown state (`allergensKnown=false`). The original `FoodDetails` listing record is only a draft; receipt must validate/copy the actual batch metadata. A real food offer requires an actual package photo, sealed shelf-stable contents, and valid date metadata. Demo illustrations are not acceptable real donation evidence.

## Inventory RPC contract for inventory-core

Proposed operations: receive(lot_id, qty), reserve(lot_id, qty), cancel(reservation_id), expire(reservation_id), pickup(reservation_id), correct(lot_id, on_hand, reason), remove(lot_id, reason). Every command also takes an idempotency_key. Receipt above pledged quantity is rejected in v1, matching Hayden's test vectors. Proposed hold duration is 24 hours, configured server-side; campus policy and any per-student cap remain team decisions before live rollout.

Each mutation must validate authorization and input, lock/update inventory conditionally, change the reservation, and append the audit event in one database transaction. Process expired holds before availability decisions. Duplicate commands return the original result; reusing an actor/key with a different canonical request hash returns IDEMPOTENCY_CONFLICT. Uniqueness is `(actorId, commandKey)` and `(memberId, idempotencyKey)`; keys must be unique across operation types per actor. Inventory-core owns command-result persistence and retries, including rejected requests.

Audit events carry lot, optional reservation, actor, kind, deltas, before/after stock and reservation counts, reason, SHA-256 request hash, and timestamp. The reservation reference is constrained to the same lot and campus. API `release` for a cancellation maps to Prisma `CANCEL`; removal maps to `REMOVE`. All audit snapshots and request hashes are required with NOT NULL constraints. Migration three upgrades the original fictional seed events using their exact fixture values; unknown incomplete rows fail migration rather than receiving invented history.

Success envelope: `{ data, request_id }`. Error envelope: `{ error: { code, message, fields? }, request_id }`. Supported error codes: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, INSUFFICIENT_STOCK, NOT_RESERVABLE, INVALID_STATE, RESERVATION_EXPIRED, IDEMPOTENCY_CONFLICT, WOULD_VIOLATE_RESERVATIONS. Never return a successful reservation before commit. UI retries retain their idempotency key and show the returned authoritative state.

## Static routing and ownership

Next.js exports to `out/` with base path `/Viking-Table`. Use static paths and query parameters for live listing identifiers; do not depend on runtime Next.js API routes, server actions, middleware, or dynamic rendering on Pages. Prefix local assets using `assetPath` and use Next links for internal navigation.

Foundation owns schema/configuration and the demo shell. UI foundation owns screen/fixture specifications. Auth owns membership/session/RLS; inventory-core owns transaction/RPC implementations and database race tests. Listing, reservation, messaging, and staff tasks consume these contracts. Coordinate schema changes in the mesh before editing shared migrations; append new migrations once one has been published.

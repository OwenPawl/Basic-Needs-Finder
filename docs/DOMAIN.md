# Initial domain contract

This is a starting proposal for the team to confirm during the foundation task. It describes required behavior without locking the implementation to an unreviewed schema or provider.

## Records and authorization

| Record | Responsibility |
| --- | --- |
| Campus | Campus identity and configured university email domains. |
| Membership | User's verified campus membership and role. Keep email/contact details private. |
| Location | A campus exchange point with hours and collection instructions. |
| Staff assignment | Explicit authority to receive, release, moderate, or reconcile stock at a location. |
| Category | Extensible catalog shared by offers and requests. |
| Listing | Offer or request, author, category, description, images, status, and timestamps. |
| Donation / stock lot | A pledged item and the quantity physically received at one location; contains food metadata where applicable. |
| Reservation | Student, stock lot, quantity, state, expiry, and relevant timestamps. |
| Inventory event | Auditable receipt, reservation, release, pickup, or correction, with actor and idempotency reference. |
| Conversation / message | Participants, related listing, message text, and timestamps. Only participants can access it. |
| Report | Reported content/user, reporter, reason, moderation status, and authorized resolution. |

Every campus-scoped operation validates membership and object ownership on the server. Location operations additionally validate staff assignment. Students cannot grant themselves staff roles. Hiding an admin button is not authorization.

## Inventory invariants

- Pledged quantities are not available stock.
- `on_hand` counts units physically received and not yet collected or removed.
- `reserved` counts units held by active reservations.
- `available = on_hand - reserved`, with `0 <= reserved <= on_hand`.
- A confirmed receipt increases `on_hand` exactly once.
- Reserving increases `reserved` only when enough available stock exists.
- Canceling or expiring an active reservation decreases `reserved` exactly once.
- Confirming pickup decreases both `on_hand` and `reserved` exactly once.
- A correction requires staff authorization, a reason, and an audit record. It cannot silently violate active reservations.
- Removed, expired, or unsafe stock is not reservable. Resolving reservations for removed stock must not accidentally make it available again.

The staff receipt, reservation, release, or pickup transition and its inventory event commit in one database transaction. Retried requests use idempotency keys and conditional state transitions.

A suitable reservation implementation can use a row lock or a conditional update that increments `reserved` only while `on_hand - reserved >= requested_quantity`, with the reservation insert in the same transaction. A client-side read followed by an unconditional decrement does not prevent overselling.

## State boundaries

Stock/donation status and reservation status are separate. A partially reserved lot can still have available units.

- Donation: `pledged` → `received`; staff may remove/quarantine stock through an auditable operation.
- Reservation: `active` → `completed`, `cancelled`, or `expired`.
- Request listing: open/fulfilled/closed; it never changes physical stock by itself.
- Carpool: separate ride and seat-reservation records in a later milestone.

Use server time for expiry and persist UTC timestamps. The reservation path must account for expired holds, even when a scheduled cleanup has not run yet. Pickup checks expiry and active state in its transaction.

## Interface groups to confirm

- Session and current campus membership.
- Listing create/read/update, search, and filters; distinguish offered items from confirmed pickup stock.
- Locations and inventory availability.
- Reserve, cancel, receive, confirm pickup, and reconcile inventory.
- Conversations and participant-only messages.
- Staff reports, moderation, and summary counts.

Return validation failures, insufficient stock, expired reservations, and forbidden operations explicitly. Agree on payloads before separate frontend/backend branches integrate. The foundation task publishes the actual schema and API/types contract; this document is not an implemented API.

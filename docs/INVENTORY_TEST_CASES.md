# Inventory test cases

Test matrix and concurrency specification for the `inventory-test-cases` task. It turns the invariants in [DOMAIN.md](DOMAIN.md) into expected outcomes **before** implementation; `inventory-core` implements executable PostgreSQL tests from them.

**Status:** proposal for review. The machine-readable source is [inventory-test-vectors.json](inventory-test-vectors.json); the tables below are generated from it, so change the JSON and regenerate rather than editing tables by hand. Error code names are placeholders until the app-foundation API contract is published.

## Conventions

- **state:** Lot state is {status, on_hand, reserved}. available = on_hand - reserved is derived, never stored independently.
- **time:** Server UTC only. A reservation is expired when server_now >= expires_at. Client-supplied timestamps are ignored.
- **hold_ttl:** HOLD_TTL is a team decision (see MVP.md). Tests must read it from configuration and control the clock; never sleep for real TTLs.
- **idempotency:** Every mutation carries an idempotency_key scoped to the acting user. Same key + same payload replays the original result without a new event. Same key + different payload is IDEMPOTENCY_CONFLICT.
- **events:** events_added counts inventory events written by the operation. Rejected operations write none.
- **errors:** Rejected operations leave lot and reservation state exactly as before.
- **pickup:** MVP pickup collects the whole reservation quantity; partial pickup is out of scope.

State columns read `status on_hand/reserved/available`. *Starts after* names the case whose end state this case starts from. Every rejected operation leaves state unchanged and writes no inventory event, except `RESERVATION_EXPIRED`, which releases the stale hold exactly once.

## Error outcomes

| Code | Meaning |
| --- | --- |
| `UNAUTHENTICATED` | No valid session. |
| `FORBIDDEN` | Authenticated but lacks the role, verification, or location staff assignment. |
| `NOT_FOUND` | Object does not exist or belongs to another campus. Used instead of FORBIDDEN where existence would leak. |
| `VALIDATION_ERROR` | Malformed or out-of-range input (quantity, missing reason, missing food metadata). |
| `INSUFFICIENT_STOCK` | Requested quantity exceeds available units. |
| `NOT_RESERVABLE` | Lot is pledged (not yet received) or removed. |
| `INVALID_STATE` | Conditional transition failed: already received, reservation not active, lot removed. |
| `RESERVATION_EXPIRED` | Reservation passed expires_at; the operation releases its hold once and refuses the request. |
| `IDEMPOTENCY_CONFLICT` | Idempotency key reused with a different payload. |
| `WOULD_VIOLATE_RESERVATIONS` | Correction would make on_hand smaller than reserved. |

## Fixtures

All data is fictional. Pledged and received lots are separate fixtures so no test can confuse an offered item with stock.

| Campus | Name | Email domains |
| --- | --- | --- |
| `campus-north` | Fictional North Campus | north.example.edu |
| `campus-south` | Fictional South Campus | south.example.edu |

| Location | Campus | Name |
| --- | --- | --- |
| `loc-commons` | `campus-north` | Commons Pantry Shelf (fictional) |
| `loc-library` | `campus-north` | Library Lobby Locker (fictional) |
| `loc-south-hall` | `campus-south` | South Hall Desk (fictional) |

| User | Campus | Role | Verified | Staff at |
| --- | --- | --- | --- | --- |
| `student-donor` | `campus-north` | student | yes | — |
| `student-a` | `campus-north` | student | yes | — |
| `student-b` | `campus-north` | student | yes | — |
| `student-unverified` | `campus-north` | student | no | — |
| `student-south` | `campus-south` | student | yes | — |
| `staff-commons` | `campus-north` | staff | yes | loc-commons |
| `staff-library` | `campus-north` | staff | yes | loc-library |
| `staff-south` | `campus-south` | staff | yes | loc-south-hall |

| Lot | Location | Title | Pledged | Start state |
| --- | --- | --- | --- | --- |
| `lot-pledged` | `loc-commons` | Toothpaste, sealed (fictional) | 2 | pledged 0/0/0 |
| `lot-two` | `loc-commons` | Bar soap, sealed (fictional) | 2 | received 2/0/2 |
| `lot-last` | `loc-commons` | Winter gloves (fictional) | 1 | received 1/0/1 |
| `lot-removed` | `loc-commons` | Granola bars, damaged packaging (fictional) | 3 | removed 0/0/0 |
| `lot-food-pledged` | `loc-commons` | Canned black beans (fictional) (allergens: unknown) | 2 | pledged 0/0/0 |
| `lot-south` | `loc-south-hall` | Spiral notebook (fictional) | 1 | received 1/0/1 |

## Pledges

| ID | Case | Actor | Operation | Starts after | Before | Expected result | After state | Reservation | Events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | Verified student pledges two units; nothing becomes available | `student-donor` | `pledge` location=loc-commons, quantity=2 | — | — | `ok` | pledged 0/0/0 | — | 0 |
| P2 | Reserving a pledged lot is refused | `student-a` | `reserve` lot=lot-pledged, quantity=1 | — | pledged 0/0/0 | `NOT_RESERVABLE` | pledged 0/0/0 | — | 0 |
| P3 | Unverified student cannot pledge | `student-unverified` | `pledge` location=loc-commons, quantity=1 | — | — | `FORBIDDEN` | — | — | 0 |
| P4 | Food pledge without known allergens stores allergens as unknown, never as none<br>*Check:* Stored food.allergens == "unknown". | `student-donor` | `pledge` location=loc-commons, quantity=2, food metadata | — | — | `ok` | pledged 0/0/0 | — | 0 |
| P5 | Food pledge missing photo or date label is rejected | `student-donor` | `pledge` location=loc-commons, quantity=1, food metadata | — | — | `VALIDATION_ERROR` | — | — | 0 |
| P6 | Unsealed or non-shelf-stable food is rejected | `student-donor` | `pledge` location=loc-commons, quantity=1, food metadata | — | — | `VALIDATION_ERROR` | — | — | 0 |

## Receipts

| ID | Case | Actor | Operation | Starts after | Before | Expected result | After state | Reservation | Events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Assigned staff confirms receipt of two units | `staff-commons` | `receive` lot=lot-pledged, quantity=2, key `rcv-1` | — | pledged 0/0/0 | `ok` | received 2/0/2 | — | 1 |
| R2 | Retrying the same receipt key changes nothing | `staff-commons` | `receive` lot=lot-pledged, quantity=2, key `rcv-1` | R1 | received 2/0/2 | `ok (replayed R1 result)` | received 2/0/2 | — | 0 |
| R3 | A second receipt with a new key is refused | `staff-commons` | `receive` lot=lot-pledged, quantity=2, key `rcv-2` | R1 | received 2/0/2 | `INVALID_STATE` | received 2/0/2 | — | 0 |
| R4 | Reusing a receipt key with a different quantity is a conflict | `staff-commons` | `receive` lot=lot-pledged, quantity=1, key `rcv-1` | R1 | received 2/0/2 | `IDEMPOTENCY_CONFLICT` | received 2/0/2 | — | 0 |
| R5 | Staff confirms fewer units than pledged; only received units count | `staff-commons` | `receive` lot=lot-pledged, quantity=1, key `rcv-3` | — | pledged 0/0/0 | `ok` | received 1/0/1 | — | 1 |
| R6 | Receipt quantity of zero, negative, fractional, or above the pledge is rejected | `staff-commons` | `receive` lot=lot-pledged, quantity_cases=[0, -1, 1.5, 3], key `rcv-bad` | — | pledged 0/0/0 | `VALIDATION_ERROR` | pledged 0/0/0 | — | 0 |
| R7 | Staff assigned to a different location cannot receive | `staff-library` | `receive` lot=lot-pledged, quantity=2, key `rcv-4` | — | pledged 0/0/0 | `FORBIDDEN` | pledged 0/0/0 | — | 0 |
| R8 | A student cannot confirm a receipt, including their own donation | `student-donor` | `receive` lot=lot-pledged, quantity=2, key `rcv-5` | — | pledged 0/0/0 | `FORBIDDEN` | pledged 0/0/0 | — | 0 |

## Reservations

| ID | Case | Actor | Operation | Starts after | Before | Expected result | After state | Reservation | Events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V1 | Student reserves one of two units | `student-a` | `reserve` lot=lot-two, quantity=1, key `res-a1` | — | received 2/0/2 | `ok` | received 2/1/1 | active, expires_at = server_now + HOLD_TTL | 1 |
| V2 | Retrying the same reservation key returns the same reservation | `student-a` | `reserve` lot=lot-two, quantity=1, key `res-a1` | V1 | received 2/1/1 | `ok (same reservation id as V1)` | received 2/1/1 | — | 0 |
| V3 | Reusing a reservation key with a different quantity is a conflict | `student-a` | `reserve` lot=lot-two, quantity=2, key `res-a1` | V1 | received 2/1/1 | `IDEMPOTENCY_CONFLICT` | received 2/1/1 | — | 0 |
| V4 | A partially reserved lot still accepts a reservation for its remaining unit | `student-b` | `reserve` lot=lot-two, quantity=1, key `res-b1` | V1 | received 2/1/1 | `ok` | received 2/2/0 | active | 1 |
| V5 | Reserving more than available is refused | `student-b` | `reserve` lot=lot-two, quantity=2, key `res-b2` | V1 | received 2/1/1 | `INSUFFICIENT_STOCK` | received 2/1/1 | — | 0 |
| V6 | Reservation quantity of zero, negative, or fractional is rejected | `student-a` | `reserve` lot=lot-two, quantity_cases=[0, -1, 0.5], key `res-bad` | — | received 2/0/2 | `VALIDATION_ERROR` | received 2/0/2 | — | 0 |
| V7 | Removed stock is not reservable | `student-a` | `reserve` lot=lot-removed, quantity=1, key `res-a2` | — | removed 0/0/0 | `NOT_RESERVABLE` | removed 0/0/0 | — | 0 |
| V8 | Unverified student cannot reserve | `student-unverified` | `reserve` lot=lot-two, quantity=1, key `res-u1` | — | received 2/0/2 | `FORBIDDEN` | received 2/0/2 | — | 0 |
| V9 | Student from another campus cannot see or reserve the lot | `student-south` | `reserve` lot=lot-two, quantity=1, key `res-s1` | — | received 2/0/2 | `NOT_FOUND` | received 2/0/2 | — | 0 |

## Cancellation

| ID | Case | Actor | Operation | Starts after | Before | Expected result | After state | Reservation | Events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Student cancels their active reservation; the hold is released once | `student-a` | `cancel` reservation=V1, key `can-a1` | V1 | received 2/1/1 | `ok` | received 2/0/2 | cancelled | 1 |
| C2 | Retrying the same cancel key changes nothing | `student-a` | `cancel` reservation=V1, key `can-a1` | C1 | received 2/0/2 | `ok (replayed C1 result)` | received 2/0/2 | cancelled | 0 |
| C3 | Cancelling again with a new key is refused; reserved never goes below zero | `student-a` | `cancel` reservation=V1, key `can-a2` | C1 | received 2/0/2 | `INVALID_STATE` | received 2/0/2 | — | 0 |
| C4 | Another student cannot cancel someone else's reservation | `student-b` | `cancel` reservation=V1, key `can-b1` | V1 | received 2/1/1 | `NOT_FOUND` | received 2/1/1 | active | 0 |
| C5 | Staff at the lot's location may release a reservation | `staff-commons` | `cancel` reservation=V1, key `can-st1` | V1 | received 2/1/1 | `ok` | received 2/0/2 | cancelled | 1 |
| C6 | Staff at a different location cannot release it | `staff-library` | `cancel` reservation=V1, key `can-st2` | V1 | received 2/1/1 | `FORBIDDEN` | received 2/1/1 | active | 0 |
| C7 | A completed (picked-up) reservation cannot be cancelled | `student-a` | `cancel` reservation=V1, key `can-a3` | K1 | received 1/0/1 | `INVALID_STATE` | received 1/0/1 | completed | 0 |

## Expiry

| ID | Case | Actor | Operation | Starts after | Before | Expected result | After state | Reservation | Events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | One second before expires_at, a sweep does nothing | `system` | `expire_sweep` clock=expires_at - 1s | V1 | received 2/1/1 | `ok (0 expired)` | received 2/1/1 | active | 0 |
| E2 | At expires_at, a sweep expires the hold and releases it once | `system` | `expire_sweep` clock=expires_at | V1 | received 2/1/1 | `ok (1 expired)` | received 2/0/2 | expired | 1 |
| E3 | Running the sweep twice releases nothing more | `system` | `expire_sweep` clock=expires_at + 1s | E2 | received 2/0/2 | `ok (0 expired)` | received 2/0/2 | expired | 0 |
| E4 | An unswept expired hold does not block the last unit<br>*Setup:* student-a holds the only unit of lot-last; the hold has passed expires_at but no sweep ran. | `student-b` | `reserve` lot=lot-last, quantity=1, clock=student-a hold expires_at + 1s, no sweep run, key `res-b3` | — | received 1/1/0 | `ok` | received 1/1/0 | student-a hold becomes expired in the same transaction; student-b hold active | 2 |
| E5 | Pickup of an expired, unswept reservation is refused and releases the hold once | `staff-commons` | `pickup` reservation=V1, clock=expires_at + 1s, no sweep run, key `pk-exp` | V1 | received 2/1/1 | `RESERVATION_EXPIRED` | received 2/0/2 | expired | 1 |
| E6 | Cancel of an expired, unswept reservation releases the hold exactly once | `student-a` | `cancel` reservation=V1, clock=expires_at + 1s, no sweep run, key `can-exp` | V1 | received 2/1/1 | `RESERVATION_EXPIRED` | received 2/0/2 | expired | 1 |

## Pickup

| ID | Case | Actor | Operation | Starts after | Before | Expected result | After state | Reservation | Events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| K1 | Assigned staff confirms pickup; on_hand and reserved both drop once | `staff-commons` | `pickup` reservation=V1, key `pk-1` | V1 | received 2/1/1 | `ok` | received 1/0/1 | completed | 1 |
| K2 | Retrying the same pickup key changes nothing | `staff-commons` | `pickup` reservation=V1, key `pk-1` | K1 | received 1/0/1 | `ok (replayed K1 result)` | received 1/0/1 | completed | 0 |
| K3 | A second pickup with a new key is refused | `staff-commons` | `pickup` reservation=V1, key `pk-2` | K1 | received 1/0/1 | `INVALID_STATE` | received 1/0/1 | completed | 0 |
| K4 | Pickup of a cancelled reservation is refused | `staff-commons` | `pickup` reservation=V1, key `pk-3` | C1 | received 2/0/2 | `INVALID_STATE` | received 2/0/2 | cancelled | 0 |
| K5 | Staff at a different location cannot confirm pickup | `staff-library` | `pickup` reservation=V1, key `pk-4` | V1 | received 2/1/1 | `FORBIDDEN` | received 2/1/1 | active | 0 |
| K6 | The reserving student cannot confirm their own pickup | `student-a` | `pickup` reservation=V1, key `pk-5` | V1 | received 2/1/1 | `FORBIDDEN` | received 2/1/1 | active | 0 |
| K7 | Picking up the last unit leaves an empty but still received lot<br>*Setup:* student-a holds the only unit of lot-last (active, unexpired). | `staff-commons` | `pickup` reservation=student-a hold on lot-last, key `pk-6` | — | received 1/1/0 | `ok` | received 0/0/0 | completed | 1 |

## Corrections

| ID | Case | Actor | Operation | Starts after | Before | Expected result | After state | Reservation | Events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| X1 | Staff corrects on_hand upward with a reason; audit records before/after<br>*Check:* Event stores actor, reason, on_hand_before=2, on_hand_after=3. | `staff-commons` | `correct` lot=lot-two, on_hand=3, reason=Found an extra bar during recount, key `cor-1` | — | received 2/0/2 | `ok` | received 3/0/3 | — | 1 |
| X2 | Correction without a reason is rejected | `staff-commons` | `correct` lot=lot-two, on_hand=1, reason=, key `cor-2` | — | received 2/0/2 | `VALIDATION_ERROR` | received 2/0/2 | — | 0 |
| X3 | Correction below the reserved count is refused | `staff-commons` | `correct` lot=lot-two, on_hand=1, reason=Recount found one bar, key `cor-3` | V4 | received 2/2/0 | `WOULD_VIOLATE_RESERVATIONS` | received 2/2/0 | — | 0 |
| X4 | Correction down to exactly the reserved count is allowed | `staff-commons` | `correct` lot=lot-two, on_hand=1, reason=Recount found one bar, key `cor-4` | V1 | received 2/1/1 | `ok` | received 1/1/0 | — | 1 |
| X5 | Negative or fractional corrected on_hand is rejected | `staff-commons` | `correct` lot=lot-two, on_hand_cases=[-1, 1.5], reason=Typo, key `cor-5` | — | received 2/0/2 | `VALIDATION_ERROR` | received 2/0/2 | — | 0 |
| X6 | Students and other-location staff cannot correct stock | `student-a`, `staff-library`, `staff-south` | `correct` lot=lot-two, on_hand=5, reason=Attempt, key `cor-6` | — | received 2/0/2 | `FORBIDDEN (student-a, staff-library); NOT_FOUND (staff-south)` | received 2/0/2 | — | 0 |

## Removal of unsafe stock

| ID | Case | Actor | Operation | Starts after | Before | Expected result | After state | Reservation | Events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| U1 | Staff removes unsafe stock with no holds; it leaves inventory<br>*Check:* Event records quantity_removed=2 and the reason. | `staff-commons` | `remove` lot=lot-two, reason=Packaging damaged, key `rm-1` | — | received 2/0/2 | `ok` | removed 0/0/0 | — | 1 |
| U2 | Removing stock with active holds cancels those holds in the same transaction | `staff-commons` | `remove` lot=lot-two, reason=Recall notice, key `rm-2` | V1 | received 2/1/1 | `ok` | removed 0/0/0 | cancelled (reason stock_removed) | 2 |
| U3 | Resolving a hold on removed stock never makes it available again | `student-a` | `cancel` reservation=V1, key `can-rm` | U2 | removed 0/0/0 | `INVALID_STATE` | removed 0/0/0 | cancelled | 0 |
| U4 | Removed stock cannot be corrected back into inventory | `staff-commons` | `correct` lot=lot-removed, on_hand=3, reason=Undo, key `cor-rm` | — | removed 0/0/0 | `INVALID_STATE` | removed 0/0/0 | — | 0 |
| U5 | Retrying the same removal key changes nothing | `staff-commons` | `remove` lot=lot-two, reason=Packaging damaged, key `rm-1` | U1 | removed 0/0/0 | `ok (replayed U1 result)` | removed 0/0/0 | — | 0 |

## Unauthorized operations

| ID | Case | Actor | Operation | Starts after | Before | Expected result | After state | Reservation | Events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Any mutation without a session is rejected | `anonymous` | `pledge, receive, reserve, cancel, pickup, correct, remove` lot=lot-two | — | received 2/0/2 | `UNAUTHENTICATED` | received 2/0/2 | — | 0 |
| A2 | A role or staff_locations claim in the request body is ignored | `student-a` | `receive` lot=lot-pledged, quantity=2, role=staff, staff_locations=['loc-commons'], key `rcv-forged` | — | pledged 0/0/0 | `FORBIDDEN` | pledged 0/0/0 | — | 0 |
| A3 | Staff from another campus cannot reach this campus's lots | `staff-south` | `pickup` reservation=V1, key `pk-south` | V1 | received 2/1/1 | `NOT_FOUND` | received 2/1/1 | active | 0 |

## Concurrency specification

### Harness

- Run against real PostgreSQL (the project database), not an in-memory fake or SQLite.
- Each racer uses its own database connection from a separate pool client, so operations are truly independent transactions at the default READ COMMITTED isolation.
- Start racers together with a barrier (e.g. Promise.all after all connections are open, or pg_advisory_lock released by a coordinator).
- Repeat each scenario at least 50 times with fresh fixtures; any single violation fails the test.
- After every iteration run the invariant checks below.

### Invariant checks after every iteration

- 0 <= reserved <= on_hand for every lot.
- reserved == sum(quantity) of that lot's active, unexpired reservations (after expiring stale holds).
- on_hand == sum(receipts) + sum(correction deltas) - sum(pickups) - sum(removals), replayed from inventory events.
- No idempotency key has more than one inventory event.
- A reservation has at most one terminal event (completed, cancelled, or expired).

### Scenarios

| ID | Race | Start | Racers | Required outcome |
| --- | --- | --- | --- | --- |
| Q1 | Two students race for the last unit | received 1/0/1 on `lot-last` | `student-a` reserve key `qa`<br>`student-b` reserve key `qb` | Exactly one ok and one INSUFFICIENT_STOCK. Final reserved=1, on_hand=1, exactly one active reservation, one reserve event. |
| Q1-stress | Ten students race for the last unit | received 1/0/1 on `lot-last` | 10 distinct verified campus-north students, reserve 1 each, distinct keys | Exactly one ok; nine INSUFFICIENT_STOCK. Final reserved=1. |
| Q2 | One student double-submits the same reservation | received 2/0/2 on `lot-two` | `student-a` reserve key `dup`<br>`student-a` reserve key `dup` | Both responses name the same reservation id (or the loser gets a retryable in-progress response that resolves to it). Final reserved=1, one reserve event. |
| Q3 | Cancel races a new reservation for the same unit | received 1/1/0 on `lot-last`; held by student-a | `student-a` cancel<br>`student-b` reserve | Either cancel commits first and student-b gets the unit (reserved=1, held by student-b) or reserve commits first and fails INSUFFICIENT_STOCK (reserved=0). Never reserved=2 or reserved<0. |
| Q4 | Expiry sweep races a reservation for an expired-held unit | received 1/1/0 on `lot-last`; held by student-a, past expires_at | `system` expire_sweep<br>`student-b` reserve | student-b succeeds. student-a's hold is expired exactly once (one release event total). Final reserved=1. |
| Q5 | Pickup races cancel on the same reservation | received 2/1/1 on `lot-two`; held by student-a | `staff-commons` pickup<br>`student-a` cancel | Exactly one succeeds; the other gets INVALID_STATE. Pickup wins: on_hand=1, reserved=0, completed. Cancel wins: on_hand=2, reserved=0, cancelled. |
| Q6 | Pickup races expiry at the deadline | received 2/1/1 on `lot-two`; held by student-a, clock = expires_at | `staff-commons` pickup<br>`system` expire_sweep | At server_now >= expires_at pickup must not succeed: RESERVATION_EXPIRED. Final on_hand=2, reserved=0, expired, one release event. |
| Q7 | Two staff confirm the same pickup with different keys | received 2/1/1 on `lot-two`; held by student-a | `staff-commons` pickup key `p1`<br>`staff-commons` pickup key `p2` | One ok, one INVALID_STATE. Final on_hand=1, reserved=0, one pickup event. |
| Q8 | Two staff confirm the same receipt with different keys | pledged 0/0/0 on `lot-pledged` | `staff-commons` receive key `r1`<br>`staff-commons` receive key `r2` | One ok, one INVALID_STATE. Final on_hand=2, one receipt event. |
| Q9 | Removal races a reservation | received 1/0/1 on `lot-last` | `staff-commons` remove<br>`student-b` reserve | Final status=removed, on_hand=0, reserved=0, no active reservations. The reserve either fails NOT_RESERVABLE or succeeds and is then cancelled by the removal transaction. |
| Q10 | Downward correction races a reservation | received 2/1/1 on `lot-two`; held by student-a | `staff-commons` correct<br>`student-b` reserve | Never reserved > on_hand. Either correction wins (on_hand=1, reserve fails INSUFFICIENT_STOCK) or reserve wins (reserved=2, correction fails WOULD_VIOLATE_RESERVATIONS). |

### Negative control

Prove Q1 can fail: behind a test-only flag, run an unsafe reserve that reads available, sleeps (pg_sleep(0.05)), then increments reserved unconditionally. Q1 must report an oversell (reserved=2) for that variant. If it does not, the harness is not racing and its passing result means nothing.

Q1 is the acceptance gate for this task's concurrency requirement: one available unit, independent clients, exactly one successful reservation.

## Open questions for the team

- HOLD_TTL value and whether staff can extend a hold (MVP.md: 'Agree on reservation expiry').
- Whether staff may confirm a receipt quantity above the pledge (these vectors reject it, R6).
- Whether a donor may reserve their own offered item.
- Per-student reservation limits per lot or per day.
- Whether a passed food date_label automatically blocks reservations or only flags the lot for staff removal (these vectors only cover staff removal).
- Final error code names and HTTP mapping belong to the app-foundation API contract; rename here once that contract is published.

## Regenerating

Run from the repository root (Python 3.9+, no dependencies):

```bash
python3 docs/tools/check_inventory_vectors.py docs/inventory-test-vectors.json
python3 docs/tools/render_inventory_cases.py docs/inventory-test-vectors.json docs/INVENTORY_TEST_CASES.md
```

The check confirms `0 <= reserved <= on_hand` for every state, that rejected cases change nothing, and that each chained case starts from its predecessor's end state.

# UI foundation: student and staff screens

> Current scope update (Nov 7): the homepage is now the anonymous WWU/Bellingham resource directory described in [WWU_RESOURCES.md](WWU_RESOURCES.md). This document describes the future exchange, not public directory behavior. Fictional data below is for tests only. Use real, permitted user/provider photos when needed; no AI-generated imagery. The old `campus-browser.tsx` demo has been removed. Keep authentication and future exchange routes separate from the public finder.

Task: `ui-foundation`. Branch: `codex/ui-foundation`. This is a screen, flow, and fixture specification. It does not claim any functional UI beyond the static catalog already delivered by `app-foundation`.

It follows [API_CONTRACT.md](API_CONTRACT.md) (field names, error codes, static routing), [DOMAIN.md](DOMAIN.md) (inventory invariants), and [MVP.md](MVP.md) (demo script). Example payloads live in [fixtures/ui-fixtures.json](fixtures/ui-fixtures.json). All names, people, and records in this document and the fixtures are fictional.

If this spec and `API_CONTRACT.md` disagree, the contract wins. Report the mismatch on the mesh and this file will follow it.

## 1. Shared conventions

### 1.1 Status vocabulary

Every status is shown with **text, an icon, and a color**. Color is never the only signal. The badge text is the accessible name, and icons are `aria-hidden`.

| Badge (UI label) | Shown when | Icon (lucide) | Token | Reservable |
| --- | --- | --- | --- | --- |
| Ready for pickup | Offer whose lot is `received` and `available > 0` | `Check` | `--status-available` (green) | Yes |
| Awaiting drop-off | Offer whose lot is `pledged` (not yet received by staff) | `Clock` | `--status-pending` (amber) | **No** |
| Currently reserved | Lot is `received` and `available = 0` because of active holds | `Lock` | `--status-reserved` (slate) | No |
| Community request | Listing `kind = request` | `HandHeart` | `--status-request` (blue) | Never: a request does not create inventory |
| Removed | Lot `removed`, or listing `removed`/`closed` | `Ban` | `--status-removed` (red) | No |
| Reserved by you | The viewer holds an `active` reservation on this lot | `Bookmark` | `--status-mine` (violet) | Already held |

Use these labels consistently in future exchange screens. They originated in the retired fictional catalog preview.

Reservation statuses (shown on My reservations and the staff views):

| `status` | UI label | Notes |
| --- | --- | --- |
| `active` | Held until {time} | Shows a relative and absolute time, e.g. "Held until Tue 3:00 pm (in 23 h)" |
| `completed` | Picked up | Shows pickup time |
| `cancelled` | Cancelled | Shows who cancelled: you or staff |
| `expired` | Hold expired | Explains that the units went back to available stock |

Rules:
- A **pledged** quantity is never shown as an availability number. Show "Pledged: 2 (awaiting drop-off)", never "2 available".
- The availability number always comes from the server `available` field, which is derived (`on_hand - reserved`). Clients never compute or decrement their own stock counter.
- An offer card always shows both the post type and the stock state, so offers and requests can't be confused.

### 1.2 Layout and narrow screens

- Mobile first. Breakpoints: **320 px** (minimum supported), **640 px** (two-column cards, side filters become a drawer button), **1024 px** (three-column cards, persistent filter sidebar, staff tables).
- No horizontal page scrolling at 320 px. The only exception is the category chip row, which scrolls horizontally on purpose (as in the foundation) and needs a visible scroll affordance.
- Tap targets are at least 44 × 44 px. Body text is at least 16 px. Inputs use 16 px text so iOS does not zoom on focus.
- Staff tables collapse into stacked cards below 640 px. Each row's label and value pair stays readable without a table header.
- Primary actions sit in a sticky bottom bar below 640 px ("Reserve 1", "Confirm receipt") so they stay reachable with one hand. The bar must not cover focused content.
- Honor `prefers-reduced-motion` (no slide or scale animations) and `prefers-color-scheme` (status tokens have dark variants with at least 4.5:1 text contrast).

### 1.3 Keyboard and focus

- Every action can be done by keyboard alone, in visual order. There is no positive `tabindex`.
- The first focusable element is a "Skip to main content" link. Each page has one `<h1>` and landmarks for `header`, `nav`, `main`, and `footer`.
- Visible focus ring: 2 px outline with 2 px offset, at least 3:1 contrast against the background, and never removed.
- Dialogs use `<dialog>` with `showModal()`. Focus goes to the dialog heading or its first field. `Escape` closes it, and focus returns to the control that opened it (already implemented for catalog details).
- After a route change, focus moves to the new page's `<h1>`, and the document title updates to "{Page} · Viking Table".
- Dismissing a toast never moves focus. A toast is not the only place an outcome appears: the result also shows inline on the page.

### 1.4 Forms

- Every input has a visible `<label>`. Placeholders are examples, never labels. Required fields say "(required)" in the label text, not just with `*`.
- Help text and errors are tied to the field with `aria-describedby`. An invalid field gets `aria-invalid="true"`.
- Validation runs on blur and on submit, never on every keystroke. The server is the authority: `VALIDATION_ERROR.fields` maps onto the same field errors.
- When a submit fails, an **error summary** appears at the top of the form with `role="alert"`. It lists each problem as a link to its field, and focus moves to the summary.
- Submit buttons show a busy state (`aria-busy`, label "Reserving…"). They are disabled only while a request is in flight. Retries reuse the **same `idempotency_key`** that was generated when the form was opened, then show the authoritative result.
- Quantity inputs use `inputmode="numeric"`, with minimum 1 and maximum equal to the server's current `available`. The server still rejects anything over.

### 1.5 Data and field names

Screens consume the snake_case wire DTOs from `API_CONTRACT.md`. The UI does not read the camelCase demo view model (`src/data/catalog.json`) in live mode.

| UI needs | Field(s) |
| --- | --- |
| Stock numbers | `lot_id`, `status` (`pledged`/`received`/`removed`), `pledged_quantity`, `on_hand`, `reserved`, `available` (server-derived) |
| Reservation | `reservation_id`, `lot_id`, `student_id`, `qty`, `status`, `expires_at`, `created_at`, `completed_at`, `cancelled_at`, `expired_at` |
| Food batch | `food.photo`, `food.date_label`, `food.best_by`, `food.package_status` (`sealed`/`opened`), `food.shelf_stable`, `food.storage`, `food.allergens` (array), `food.allergens_known` (boolean) |
| Commands | `idempotency_key` on every mutation |
| Envelopes | Success `{ data, request_id }`. Error `{ error: { code, message, fields? }, request_id }` |

**Allergens are shown honestly:**
- `allergens_known = false`: show "Allergens: unknown. Check the package label." Never show "None".
- `allergens_known = true` with `[]`: show "Allergens: none listed on package".
- `allergens_known = true` with items: list them as text.

Times arrive in UTC (`timestamptz`) and are displayed in the campus local time zone, using a `<time datetime>` element.

### 1.6 Loading, empty, and error states

Every data region has all four states specified (see each screen):

- **Loading:** skeleton blocks that match the final layout, with `aria-busy="true"` on the region. A text status "Loading listings…" goes in a polite live region. There are no spinner-only states.
- **Empty:** a one-sentence explanation plus the next useful action, such as "Clear filters" or "Offer an item".
- **Error:** an inline message from the error map in section 5, with a "Try again" button. Partial data that already loaded stays visible.
- **Unavailable backend:** if live configuration is missing, show "Live accounts aren't connected in this preview" and keep public directory browsing available. Never silently send real actions into demo data (see `DEPLOYMENT.md`).

Live regions: use one polite region (`role="status"`) per page for results counts and successes, and `role="alert"` only for blocking errors. Announce availability changes after a mutation, e.g. "Reserved 1. 1 still available."

## 2. Student screens

Routes are static export paths under the base path `/Viking-Table`. Object identifiers use query parameters (section 6).

### S1. Browse and search (`/`)

- Search field (label "Search offers and requests"), post type segmented control (All / Offers / Requests), category chips, location select, "Available now only" checkbox, sort (Newest / Most available).
- Results announce "12 results" in the polite region after filtering. The query lives in the URL (`?q=&type=&category=&location=&available=1`) so links can be shared.
- Card: permitted real photo with alt text, or a text-only fallback, title, status badge (1.1), category, location, and created time. Offers that are ready show "N available".
- Empty: "No listings match these filters." with a "Clear filters" button. Error: list fetch failed, with retry.

### S2. Listing detail (`/listing/?id={listing_id}`)

- Shows the title, badge, description, images, category, author display name (no email or contact details), location card (hours and collection instructions), and created time.
- Offers show their stock lot: "Ready for pickup: N available", "Awaiting drop-off: pledged N", or "Currently reserved".
- Food shows the batch metadata from 1.5 (photo, date label, sealed, shelf-stable, storage, allergens).
- Actions: **Reserve** (only when `available > 0` and the viewer is a verified student), **Message** (opens or creates the conversation, S6), and **Report** (dialog with reason select and details textarea).
- Requests show "Can you help?" with only a Message action. There is no reserve button.
- A pledged offer shows the Reserve button as disabled, with visible text explaining why: "This item hasn't been dropped off yet. You can reserve it once staff confirm receipt." The text is wired to the button with `aria-describedby`.
- Not found or other campus: "This listing isn't available." (`NOT_FOUND`)

### S3. Create or edit a listing (`/listings/new/`, `/listings/edit/?id=`)

- Step 1: choose Offer or Request with a radio group (legend "What are you posting?").
- Fields: title (required, max 80), description (required), category (required), location (required for offers), quantity (offers, required, minimum 1), images (offers need at least 1).
- When category is **Food**, a fieldset "Food safety details" appears. It asks for package photo (required), date label type and date (required), "Package is sealed" (required, must be checked), "Shelf-stable, no refrigeration" (required, must be checked), storage (required), and allergens.
- The allergens control is a radio group: "I know the allergens" (then checkboxes plus "Other") or "I don't know". Choosing "I don't know" sets `allergens_known = false`. The form never defaults to "none".
- Opened or perishable food is blocked with field errors that quote the rule from `MVP.md`.
- On success, go to S2 for the new listing. Offers show the "Awaiting drop-off" badge and drop-off instructions for the chosen location.

### S4. Reserve confirmation (dialog on S2)

- Quantity input (default 1, maximum `available`), pickup location card, and hold length text from the server: "We'll hold it until {expires_at}".
- Confirm sends `reserve(lot_id, qty, idempotency_key)`. Success replaces the dialog body with "Reserved" and shows the reservation summary plus a link to S5. Focus goes to the success heading.
- Race lost (`INSUFFICIENT_STOCK`): "Someone reserved the last one just before you. 0 available." The fresh `available` value appears and the reserve button is disabled. This is the expected loser path in demo step 7.
- `NOT_RESERVABLE`: "This item can't be reserved right now." The page refreshes the lot state.

### S5. My reservations (`/reservations/`)

- Tabs: Active / Past. Each active card shows the item, qty, location, instructions, and "Held until" with a relative time, plus a **Cancel reservation** button that opens a confirm dialog.
- After cancelling, the polite region announces "Reservation cancelled. 2 now available." and the card moves to Past.
- An expired hold shows "Hold expired on {time}. The item went back to available stock." with a link back to the listing.
- Empty: "You have no active reservations." with a "Browse available items" link.

### S6. Inbox and conversation (`/inbox/`, `/inbox/?conversation={id}`)

- The list shows the listing title, other participant's display name, last message preview, and time. Unread conversations show a text "Unread" badge, not just a dot.
- Conversation view: messages in a list (`role="log"`, `aria-live="polite"`) where each message shows the sender name and a `<time>`. The composer is a labelled textarea with a Send button. `Enter` inserts a new line and `Ctrl/Cmd+Enter` sends. The shortcut is documented in the help text.
- Privacy note under the composer: "Don't share personal contact details. Meet only at the listed campus location."
- Only participants can open a conversation. Anyone else gets `NOT_FOUND` and the copy "This conversation isn't available."

### S7. Profile and history (`/profile/`, `/profile/?member={id}`)

- Own profile: display name, campus, verification state ("Verified student"), My offers, My requests, and Exchange history (completed pickups and fulfilled requests). Each list has its own empty state.
- Public profile of another student: display name and their open listings only. No email, history details, or reservations.

## 3. Staff screens

Staff screens appear only for members with a `StaffAssignment` at the location. Hiding navigation is a convenience, not authorization: the server enforces it, and the UI shows `FORBIDDEN` copy if it's reached anyway.

### T1. Staff inventory dashboard (`/staff/?location={id}`)

- Location switcher (only assigned locations). Summary tiles: Awaiting drop-off, Ready for pickup (units), Reserved (units), Pickups today, Open reports. Each tile is a link to the filtered list.
- Lot table/cards: item, status badge, pledged, on hand, reserved, available, oldest active hold. Sorting is by header buttons with `aria-sort`.
- Empty: "No stock at this location yet."

### T2. Confirm receipt (`/staff/lot/?id={lot_id}`, receipt panel)

- Shows the pledge (item, donor display name, pledged quantity) and, for food, the batch checklist: photo matches package, sealed, shelf-stable, date label, storage, and allergens copied from the package.
- "Quantity received" input (maximum `pledged_quantity`, since receipt above pledge is rejected in v1) and **Confirm receipt**.
- Success: "Received 2. 2 now available." The lot badge changes to Ready for pickup.

### T3. Confirm pickup (`/staff/pickups/?location={id}`)

- List of active reservations at the location: student display name, item, qty, and held until. Search by reservation code (the short code shown to the student on S5).
- **Confirm pickup** opens a dialog with the reservation summary. Success: "Picked up. On hand 1, reserved 0."
- `RESERVATION_EXPIRED`: "This hold expired at {time}. The units are back in available stock. The student can reserve again if any are available."

### T4. Correct or remove stock (lot detail panel)

- Correction: new on-hand count plus a required reason. If it would go below the reserved count, show `WOULD_VIOLATE_RESERVATIONS` inline: "On hand can't go below 1 because 1 unit is reserved. Resolve those holds first."
- Remove (unsafe, expired, or damaged) requires a reason. The confirm dialog states that it can't be undone and that active holds on the lot are resolved without making the stock available.
- Audit trail list: event kind, delta, before and after values, actor role (not personal details in shared views), reason, and time.

### T5. Moderation and reports (`/staff/reports/`)

- Open reports: listing link, reason, time, and actions **Remove listing** or **Dismiss** (both need a note). Resolved reports appear on a separate tab.
- Basic exchange counts for the location and date range: received units, pickups, cancellations, expiries.

## 4. Demo walkthrough (MVP.md demonstration script)

Fixture keys refer to `demo_steps` in `fixtures/ui-fixtures.json`. Each step lists the screen and the expected visible state.

| Step | Actor | Screen | Expected visible state | Lot (on_hand / reserved / available) |
| --- | --- | --- | --- | --- |
| 1 | Student A (Rowan) | S3 → S2 | Offer "Sealed pantry pair" created at Student Union with qty 2. Badge **Awaiting drop-off** | pledged 2; 0 / 0 / 0 |
| 2 | Student A, Student B | S2 | Reserve button disabled with an explanation. S1 with "Available now only" checked doesn't list it | 0 / 0 / 0 |
| 3 | Staff (Morgan) | T2 | Confirm receipt of 2. Toast and inline "2 now available". Badge **Ready for pickup** | 2 / 0 / 2 |
| 4 | Student B (Sam) | S1 → S2 → S6 → S4 | Finds the item, sends a message, reserves 1. "Reserved", held until +24 h | 2 / 1 / 1 |
| 5 | Student B | S5 | Cancels. "2 now available" announced once. Card moves to Past as Cancelled | 2 / 0 / 2 |
| 6 | Student B, Staff | S4, T3 | Reserves 1 again, then staff confirms pickup. "Picked up" | after reserve 2 / 1 / 1; after pickup 1 / 0 / 1 |
| 7 | Students B and C race | S4 (two sessions) | One sees "Reserved". The other sees the `INSUFFICIENT_STOCK` copy and 0 available | 1 / 1 / 0 |
| 8 | Any | S1, S2 (offer and request), S7, T1 at 320 px | Offer and request visibly distinct; profile history shows the completed pickup; staff summary tiles stack in one column | 1 / 1 / 0 |

## 5. Error code to message map

The UI keys messages by `error.code`, never by parsing `error.message`. Every message says what happened and what the user can do next.

| Code | Where | Message | UI behavior |
| --- | --- | --- | --- |
| `UNAUTHENTICATED` | Any mutation | "Please sign in to continue." | Go to sign-in, then return to the same page and keep the form draft |
| `FORBIDDEN` | Staff screens, others' listings | "You don't have permission to do this at this location." | No retry button |
| `NOT_FOUND` | Detail routes, other campus | "This item isn't available." | Link back to Browse. Don't reveal whether it exists elsewhere |
| `VALIDATION_ERROR` | Forms | "Some details need fixing." plus field errors from `fields` | Error summary (1.4) |
| `INSUFFICIENT_STOCK` | Reserve | "Not enough left to reserve {qty}. {available} available now." | Refresh the lot. Lower the max quantity or disable reserve |
| `NOT_RESERVABLE` | Reserve | "This item can't be reserved yet or has been removed." | Refresh the lot badge |
| `RESERVATION_EXPIRED` | Pickup, cancel | "This hold expired at {time}. The units went back to available stock." | Refresh the reservation and lot |
| `INVALID_STATE` | Cancel, pickup, receipt | "This was already completed or changed. Showing the latest status." | Refresh. Treat it as information, not failure |
| `WOULD_VIOLATE_RESERVATIONS` | Correction | "On hand can't go below the {reserved} units currently reserved." | Inline on the field |
| `IDEMPOTENCY_CONFLICT` | Any retry | "This request conflicts with an earlier one. Reload and try again." | Generate a new key only after a reload |
| Network or timeout | Any | "We couldn't reach the server. Your request may not have gone through." | Retry with the **same** `idempotency_key`, then show the authoritative state |

## 6. Static hosting constraints (GitHub Pages + Supabase)

Following `note:pages-free-backend` and `API_CONTRACT.md`:

- The static export has no dynamic `[id]` routes, API routes, server actions, or middleware. Detail pages read `?id=` on the client. Links use Next `<Link>` with the base path, and assets use `assetPath`.
- All mutations go through Supabase RPC functions protected by RLS. The browser never updates stock, reservation, or event rows directly. The UI holds only a publishable or anon key.
- Demo mode is visibly labelled on every page ("Fictional demo data: reservations are not real"). In live mode, missing configuration shows the unavailable state from 1.6.
- Direct deep links (`/listing/?id=…`) must work on a cold load. When the id is missing or malformed, show the S2 not-found state.

## 7. Proposed shared component ownership

To avoid duplicate implementations across tasks:

| Component | Owner task | Used by |
| --- | --- | --- |
| `StatusBadge`, status tokens, `Time` | listings-discovery (first consumer) | All |
| `Dialog` (focus trap, Escape, focus return) | app-foundation (exists in catalog) | S2, S4, S5, T3, T4 |
| `FormField`, `ErrorSummary`, `useIdempotentCommand` | listings-discovery | S3, S4, T2, T4 |
| `LocationCard` | app-foundation (exists) | S2, S4, S5, T1 |
| `LotStockPanel` | reservation-flow | S2, T1, T2 |
| `ErrorMessage` (section 5 map) | reservation-flow | All mutations |
| Inbox components | private-messaging | S6 |
| Staff tables and tiles | staff-console | T1–T5 |

## 8. Open questions for the team

- **Hold length (`HOLD_TTL`).** The fixtures assume the proposed 24 h server-side default. The UI always shows `expires_at` from the server and never hard-codes the duration.
- **Per-student reservation limit.** Undecided. If one is added, it needs an error code. Until then, the UI shows only what the server returns.
- **Reservation code format** for staff pickup lookup (T3). Proposed: a short code shown to the student and searchable by staff. This needs a field in the contract.
- **Display names.** These need a profile field, not an email-derived name. Contact details are never shown.

# MVP scope

> Current demo priority (Nov 7, user correction): anonymous WWU/Bellingham food-resource discovery, official sources and hours, directions/transit, SNAP help, and printable plans. No AI images or fictional public offerings. The exchange below remains the original implementation plan and must not be represented as live until verified. See [WWU_RESOURCES.md](WWU_RESOURCES.md).


## Goal

Help students meet basic needs through free offers and requests, private conversations, and reliable pickup at campus exchange locations.

The hackathon demo should prove one complete resource exchange with persistent data and correct inventory changes. Seed records must be clearly fictional; the demo must not imply a real university has approved locations or procedures.

## Required in the first working version

- Student sign-in, university-email verification, and server-side authorization.
- Profiles with the student's listings, requests, and exchange history.
- Offers and requests with title, description, category, images, quantities where appropriate, location, status, and creation time.
- Keyword search and filters for post type, category, location, availability, and recent listings.
- Campus locations with a view of confirmed inventory.
- Staff-confirmed receipts and pickups, student reservations, cancellation, and expiry.
- Basic private messaging associated with listings.
- A staff inventory dashboard with moderation, reporting, and basic exchange counts.
- Responsive and accessible student and staff flows.
- Persistent storage, realistic seed data, environment examples, migrations, setup instructions, and meaningful inventory tests.

Keep the category catalog configurable. Seed the categories listed in the original plan, but specialized features for a category can follow later. A request expresses a need; it does not create inventory.

## Food in the MVP

If food is accepted in the demo, require a photo, quantity, date label, package status, storage information, and known allergens. Restrict donations to sealed, shelf-stable items, following the supplied plan. Unknown allergen information must remain unknown. Staff can remove unsafe or expired donations from availability. Institution-specific food guidance requires campus review before any real pilot.

## After the core flow works

- Carpool offers and requests, capacity reservations, ride search, and reporting. Ride capacity is separate from physical-goods inventory.
- Expanded in-app notifications and optional email/push delivery.
- Dietary and food-type discovery beyond the minimum listing information.
- More advanced matching, saved searches, and reporting.
- Institution-specific procedures and additional campus integrations.

Persist timestamps and states needed for notifications now. Basic transaction confirmations and visible reservation status belong in the MVP even before notification delivery is built.

## Demonstration script

1. Sign in as a verified demo student and offer two fictional sealed pantry items at a seeded campus location.
2. Show that the offer is pending drop-off and cannot yet be reserved.
3. Sign in as a staff member authorized for that location and confirm receipt of two units. Available inventory becomes two.
4. Sign in as a second student, find the item, open a private conversation, and reserve one unit. Available inventory becomes one.
5. Cancel that reservation. Available inventory returns to two exactly once.
6. Reserve one unit again. Staff confirms pickup. Physical stock decreases to one and reserved quantity becomes zero.
7. Run the concurrent-last-item test: two students race to reserve the one remaining unit; exactly one succeeds.
8. Show an offer, a request, a profile/history view, and the staff inventory summary on a narrow screen.

If a development email inbox is used, visibly label it as a demo setup. A production flow must not silently bypass verification.

## Team decisions still needed

- Confirm the proposed stack and hosting/database choices after inspecting available services.
- Choose an authentication and university-domain verification approach.
- Identify the first campus, approved locations, and authorized staff for a real pilot.
- Agree on reservation expiry and collection instructions.
- Choose each participant's first task. No work has been assigned by assumption.

## Completion evidence

A task submission includes an immutable commit, acceptance checks actually performed, and reproducible setup. Another participant reviews it. Record integration separately, then verify the demo against that same integration commit. The planning files do not represent completed application features.

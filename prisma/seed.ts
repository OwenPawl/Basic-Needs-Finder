import { createHash } from "node:crypto";
import { createDatabase } from "../src/lib/db";
import { categories, items, locations, seedId } from "./demo-data";
const connection = new URL(process.env.DATABASE_URL!);
if (
  !["localhost", "127.0.0.1", "::1", "[::1]"].includes(connection.hostname) &&
  process.env.ALLOW_DEMO_SEED !== "1"
) {
  throw new Error(
    "Demo seeding is limited to localhost. To intentionally seed a remote demo database, set ALLOW_DEMO_SEED=1.",
  );
}
const db = createDatabase();
try {
  await db.$transaction(async (tx) => {
    await tx.campus.upsert({
      where: { id: seedId(1) },
      update: {},
      create: {
        id: seedId(1),
        slug: "demo-campus",
        name: "Demo Campus",
        emailDomains: ["students.example.invalid"],
        isDemo: true,
      },
    });
    for (const [id, name, role] of [
      [2, "Demo Student", "STUDENT"],
      [3, "Demo Volunteer", "STAFF"],
    ] as const) {
      await tx.user.upsert({
        where: { id: seedId(id) },
        update: {},
        create: {
          id: seedId(id),
          email: `sample-${id}@students.example.invalid`,
          displayName: name,
        },
      });
      await tx.membership.upsert({
        where: { id: seedId(id + 20) },
        update: {},
        create: {
          id: seedId(id + 20),
          campusId: seedId(1),
          userId: seedId(id),
          role,
          verifiedAt: new Date("2026-11-01T00:00:00Z"),
        },
      });
    }
    for (const location of locations) {
      await tx.location.upsert({
        where: { id: location.id },
        update: {},
        create: { ...location, campusId: seedId(1) },
      });
      await tx.staffAssignment.upsert({
        where: {
          membershipId_locationId: {
            membershipId: seedId(23),
            locationId: location.id,
          },
        },
        update: {},
        create: {
          campusId: seedId(1),
          membershipId: seedId(23),
          locationId: location.id,
        },
      });
    }
    for (const category of categories)
      await tx.category.upsert({
        where: { id: category.id },
        update: {},
        create: category,
      });
    for (const item of items) {
      await tx.listing.upsert({
        where: { id: seedId(item.id) },
        update: {},
        create: {
          id: seedId(item.id),
          campusId: seedId(1),
          authorId: seedId(22),
          categoryId: item.categoryId,
          locationId: seedId(item.location),
          title: item.title,
          description: item.description,
          kind: item.kind,
          quantity: item.quantity,
          images: [`/illustrations/${item.image}.svg`],
          isDemo: true,
          createdAt: new Date(item.createdAt),
        },
      });
      if (item.categoryId === "food")
        await tx.foodDetails.upsert({
          where: { listingId: seedId(item.id) },
          update: {},
          create: {
            listingId: seedId(item.id),
            foodName: item.title,
            dateLabel: "Best before",
            bestBy: new Date("2027-04-01T00:00:00Z"),
            opened: false,
            shelfStable: true,
            storage:
              "Store sealed in a cool, dry place. Demo information only.",
            allergens: [],
            allergensKnown: false,
          },
        });
      if (item.kind === "OFFER") {
        await tx.stockLot.upsert({
          where: { id: seedId(item.id + 1000) },
          update: {},
          create: {
            id: seedId(item.id + 1000),
            campusId: seedId(1),
            listingId: seedId(item.id),
            locationId: seedId(item.location),
            pledged: item.quantity,
            onHand: item.onHand,
            reserved: item.reserved,
            status: item.stockStatus,
            receivedAt:
              item.stockStatus === "RECEIVED" ? new Date(item.createdAt) : null,
          },
        });
        if (item.categoryId === "food")
          await tx.stockFoodDetails.upsert({
            where: { stockLotId: seedId(item.id + 1000) },
            update: {},
            create: {
              stockLotId: seedId(item.id + 1000),
              foodName: item.title,
              photo: `/illustrations/${item.image}.svg`,
              dateLabel: "Best before",
              bestBy: new Date("2027-04-01T00:00:00Z"),
              opened: false,
              shelfStable: true,
              storage:
                "Store sealed in a cool, dry place. Demo information only.",
              allergens: [],
              allergensKnown: false,
            },
          });
        if (item.stockStatus === "RECEIVED")
          await tx.inventoryEvent.upsert({
            where: {
              actorId_commandKey: {
                actorId: seedId(23),
                commandKey: `demo-receipt-${item.id}`,
              },
            },
            update: {},
            create: {
              campusId: seedId(1),
              stockLotId: seedId(item.id + 1000),
              actorId: seedId(23),
              kind: "RECEIPT",
              onHandDelta: item.onHand,
              reservedDelta: 0,
              reason: "Fictional seed receipt",
              commandKey: `demo-receipt-${item.id}`,
              requestHash: createHash("sha256")
                .update(JSON.stringify({ lot: item.id, quantity: item.onHand }))
                .digest("hex"),
              onHandBefore: 0,
              onHandAfter: item.onHand,
              reservedBefore: 0,
              reservedAfter: 0,
            },
          });
        if (item.reserved) {
          const reservation = await tx.reservation.upsert({
            where: {
              memberId_idempotencyKey: {
                memberId: seedId(22),
                idempotencyKey: `demo-hold-${item.id}`,
              },
            },
            update: {},
            create: {
              campusId: seedId(1),
              stockLotId: seedId(item.id + 1000),
              memberId: seedId(22),
              quantity: item.reserved,
              expiresAt: new Date("2027-01-01T00:00:00Z"),
              idempotencyKey: `demo-hold-${item.id}`,
            },
          });
          await tx.inventoryEvent.upsert({
            where: {
              actorId_commandKey: {
                actorId: seedId(22),
                commandKey: `demo-hold-${item.id}`,
              },
            },
            update: {},
            create: {
              campusId: seedId(1),
              stockLotId: seedId(item.id + 1000),
              actorId: seedId(22),
              kind: "RESERVE",
              onHandDelta: 0,
              reservationId: reservation.id,
              requestHash: createHash("sha256")
                .update(
                  JSON.stringify({ lot: item.id, quantity: item.reserved }),
                )
                .digest("hex"),
              onHandBefore: item.onHand,
              onHandAfter: item.onHand,
              reservedBefore: 0,
              reservedAfter: item.reserved,
              reservedDelta: item.reserved,
              reason: "Fictional seed hold",
              commandKey: `demo-hold-${item.id}`,
            },
          });
        }
      }
    }
  });
  console.log(
    "Demo data seeded without overwriting existing records. No real campus, students, or donations are represented.",
  );
} finally {
  await db.$disconnect();
}

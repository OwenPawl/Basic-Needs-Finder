import { mkdir, writeFile } from "node:fs/promises";
import { createDatabase } from "../src/lib/db";
import { catalogSchema, stockAvailability } from "../src/lib/catalog";
const db = createDatabase();
try {
  const campus = await db.campus.findUniqueOrThrow({
    where: { slug: "demo-campus" },
    include: { locations: { orderBy: { name: "asc" } } },
  });
  if (!campus.isDemo)
    throw new Error(
      "Refusing to export a non-demo campus into the public static site.",
    );
  const listings = await db.listing.findMany({
    where: { campusId: campus.id, isDemo: true, status: "OPEN" },
    include: { stock: { include: { food: true } } },
    orderBy: { createdAt: "desc" },
  });
  const catalog = catalogSchema.parse({
    mode: "demo",
    campus: { id: campus.id, name: campus.name, isDemo: true },
    categories: await db.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    locations: campus.locations.map(
      ({ id, name, building, hours, instructions }) => ({
        id,
        name,
        building,
        hours,
        instructions,
      }),
    ),
    resources: listings.map((listing) => {
      const available = listing.stock.reduce(
        (sum, lot) =>
          sum + stockAvailability(lot.status, lot.onHand, lot.reserved),
        0,
      );
      const received = listing.stock.some((lot) => lot.status === "RECEIVED");
      const food = listing.stock.find((lot) => lot.food)?.food;
      return {
        id: listing.id,
        title: listing.title,
        description: listing.description,
        categoryId: listing.categoryId,
        kind: listing.kind,
        locationId: listing.locationId,
        status:
          listing.kind === "REQUEST"
            ? "REQUEST"
            : available > 0
              ? "AVAILABLE"
              : received
                ? "RESERVED"
                : "PENDING",
        available,
        quantity: listing.quantity,
        image: listing.images[0] ?? "/illustrations/notebooks.svg",
        imageDescription: "Illustration of a fictional sample resource",
        createdAt: listing.createdAt.toISOString(),
        food: food
          ? {
              name: food.foodName,
              dateLabel: food.dateLabel,
              bestBy: food.bestBy.toISOString().slice(0, 10),
              opened: food.opened,
              shelfStable: food.shelfStable,
              storage: food.storage,
              allergens: food.allergens,
              allergensKnown: food.allergensKnown,
            }
          : null,
      };
    }),
  });
  await mkdir("src/data", { recursive: true });
  await writeFile(
    "src/data/catalog.json",
    JSON.stringify(catalog, null, 2) + "\n",
  );
  console.log(
    `Exported ${catalog.resources.length} fictional resources. No user, membership, message, or credential records were exported.`,
  );
} finally {
  await db.$disconnect();
}

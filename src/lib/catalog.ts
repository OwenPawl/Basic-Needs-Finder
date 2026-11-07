import { z } from "zod";

export const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  building: z.string(),
  hours: z.string(),
  instructions: z.string(),
});
export const resourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  categoryId: z.string(),
  kind: z.enum(["OFFER", "REQUEST"]),
  locationId: z.string(),
  status: z.enum(["AVAILABLE", "PENDING", "RESERVED", "REQUEST"]),
  available: z.number().int().nonnegative(),
  quantity: z.number().int().positive().nullable(),
  image: z.string(),
  imageDescription: z.string(),
  createdAt: z.string().datetime(),
  food: z
    .object({
      name: z.string(),
      dateLabel: z.string(),
      bestBy: z.string(),
      opened: z.boolean(),
      shelfStable: z.boolean(),
      storage: z.string(),
      allergens: z.array(z.string()),
      allergensKnown: z.boolean(),
    })
    .nullable(),
});
export const catalogSchema = z.object({
  mode: z.literal("demo"),
  campus: z.object({
    id: z.string(),
    name: z.string(),
    isDemo: z.literal(true),
  }),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
  locations: z.array(locationSchema),
  resources: z.array(resourceSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;
export type Resource = z.infer<typeof resourceSchema>;
export type CatalogFilters = {
  query: string;
  category: string;
  location: string;
  kind: "ALL" | "OFFER" | "REQUEST";
  availableOnly: boolean;
  sort: "recent" | "title";
};

export function filterResources(
  resources: Resource[],
  filters: CatalogFilters,
): Resource[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return resources
    .filter(
      (item) =>
        (!query ||
          `${item.title} ${item.description}`
            .toLocaleLowerCase()
            .includes(query)) &&
        (!filters.category || item.categoryId === filters.category) &&
        (!filters.location || item.locationId === filters.location) &&
        (filters.kind === "ALL" || item.kind === filters.kind) &&
        (!filters.availableOnly ||
          (item.kind === "OFFER" &&
            item.status === "AVAILABLE" &&
            item.available > 0)),
    )
    .sort((a, b) =>
      filters.sort === "title"
        ? a.title.localeCompare(b.title)
        : b.createdAt.localeCompare(a.createdAt),
    );
}

export function stockAvailability(
  status: "PLEDGED" | "RECEIVED" | "REMOVED",
  onHand: number,
  reserved: number,
): number {
  if (
    !Number.isInteger(onHand) ||
    !Number.isInteger(reserved) ||
    onHand < 0 ||
    reserved < 0 ||
    reserved > onHand
  )
    throw new Error("Invalid stock counters");
  return status === "RECEIVED" ? onHand - reserved : 0;
}

export function assetPath(path: string) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}

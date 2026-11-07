import { z } from "zod";
export const exchangeLocationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  building: z.string(),
  hours: z.string(),
  instructions: z.string(),
});
export const foodSchema = z.object({
  food_name: z.string().trim().min(1).max(100),
  date_label: z.enum(["best_by", "use_by", "expiration"]),
  best_by: z.iso.date(),
  opened: z.literal(false),
  shelf_stable: z.literal(true),
  storage: z.string().trim().min(1).max(500),
  allergens: z.array(z.string().trim().min(1).max(80)).max(20),
  allergens_known: z.boolean(),
});
export const listingInputSchema = z
  .object({
    kind: z.enum(["offer", "request"]),
    title: z.string().trim().min(3).max(80),
    description: z.string().trim().min(10).max(2000),
    category_id: z.string().min(1),
    location_id: z.uuid(),
    quantity: z.number().int().min(1).max(1000).nullable(),
    images: z.array(z.string()).max(4),
    food: foodSchema.nullable(),
  })
  .superRefine((x, ctx) => {
    if (x.kind === "offer" && x.quantity === null)
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Enter the number of items you are offering.",
      });
    if (x.kind === "offer" && !x.images.length)
      ctx.addIssue({
        code: "custom",
        path: ["images"],
        message: "Add a real photo of the item.",
      });
    if (x.kind === "offer" && x.category_id === "food" && !x.food)
      ctx.addIssue({
        code: "custom",
        path: ["food"],
        message: "Complete the food information.",
      });
    if (x.food && !x.food.allergens_known && x.food.allergens.length)
      ctx.addIssue({
        code: "custom",
        path: ["food", "allergens"],
        message: "Unknown allergens must remain unknown.",
      });
    if (x.category_id === "transportation")
      ctx.addIssue({
        code: "custom",
        path: ["category_id"],
        message: "Rides use separate seat reservations, not goods inventory.",
      });
  });
export type ListingInput = z.infer<typeof listingInputSchema>;
export const listingSchema = z.object({
  id: z.uuid(),
  campus_id: z.uuid(),
  author_id: z.uuid(),
  title: z.string(),
  description: z.string(),
  category_id: z.string(),
  category_name: z.string(),
  kind: z.enum(["offer", "request"]),
  status: z.enum(["open", "fulfilled", "closed", "removed"]),
  quantity: z.number().int().nullable(),
  images: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
  is_demo: z.boolean(),
  is_owner: z.boolean(),
  location: exchangeLocationSchema,
  lots: z.array(
    z.object({
      lot_id: z.uuid(),
      status: z.enum(["pledged", "received", "removed"]),
      pledged_quantity: z.number(),
      on_hand: z.number(),
      reserved: z.number(),
      available: z.number(),
    }),
  ),
  food: foodSchema.nullable(),
});
export type ExchangeListing = z.infer<typeof listingSchema>;
export const exchangeCatalogSchema = z.object({
  campus: z.object({ id: z.uuid(), name: z.string(), is_demo: z.boolean() }),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
  locations: z.array(exchangeLocationSchema),
});
export type ExchangeCatalog = z.infer<typeof exchangeCatalogSchema>;
export const listingPageSchema = z.object({
  listings: z.array(listingSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});
export const emptyFilters = {
  query: "",
  kind: "",
  category: "",
  location: "",
  available: false,
  mine: false,
  sort: "recent",
  page: 0,
};
export type ExchangeFilters = typeof emptyFilters;
export function listingState(listing: ExchangeListing) {
  if (listing.status !== "open")
    return {
      label: listing.status === "fulfilled" ? "Fulfilled" : "Closed",
      tone: "closed",
    };
  if (listing.kind === "request")
    return { label: "Community request", tone: "request" };
  const available = listing.lots.reduce(
    (n, lot) => n + (lot.status === "received" ? lot.available : 0),
    0,
  );
  if (available > 0)
    return { label: `${available} ready for pickup`, tone: "available" };
  if (listing.lots.some((l) => l.status === "received" && l.reserved > 0))
    return { label: "Currently reserved", tone: "reserved" };
  if (listing.lots.some((l) => l.status === "pledged"))
    return { label: "Awaiting drop-off", tone: "pending" };
  return { label: "No items available", tone: "closed" };
}
export function exchangeError(error: { message?: string } | null) {
  const code = error?.message ?? "";
  const known: Record<string, string> = {
    UNAUTHENTICATED: "Sign in with your university email to continue.",
    FORBIDDEN:
      "Verify your campus membership or check that you have permission for this action.",
    NOT_FOUND:
      "This listing or pickup location is not available to your account.",
    INVALID_STATE:
      "This item changed or has already been processed. Refresh to see its current state.",
    VALIDATION_ERROR:
      "Check the listing information, quantity and photos, then try again.",
    IDEMPOTENCY_CONFLICT:
      "This submission changed after a retry. Refresh before trying again.",
    INSUFFICIENT_STOCK:
      "Someone may have reserved those items. Refresh to see what remains.",
  };
  return (
    known[code] ??
    "We could not reach the exchange. Your changes have not been confirmed. Please try again."
  );
}

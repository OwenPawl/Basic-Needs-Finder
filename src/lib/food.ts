import { z } from "zod";
import { exchangeClient } from "./exchange-api";

// Community food posts (migration 202611070013_food_posts). Student-to-student
// meals and free-food events; separate from the sealed-goods exchange.

export const foodPostSchema = z.object({
  id: z.uuid(),
  campus_id: z.uuid(),
  kind: z.enum(["meal", "event"]),
  title: z.string(),
  description: z.string(),
  photos: z.array(z.string()),
  servings: z.number().int().nullable(),
  prepared_at: z.string().nullable(),
  available_from: z.string(),
  available_until: z.string(),
  pickup_place: z.string(),
  pickup_instructions: z.string(),
  ingredients: z.string(),
  allergens: z.array(z.string()),
  allergens_known: z.boolean(),
  handling: z.string(),
  status: z.enum(["open", "closed", "removed"]),
  state: z.enum(["available", "upcoming", "expired", "closed", "removed"]),
  author_name: z.string(),
  is_owner: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable(),
});
export type FoodPost = z.infer<typeof foodPostSchema>;

export type FoodPostInput = {
  kind: "meal" | "event";
  title: string;
  description: string;
  photos: string[];
  servings: number | null;
  prepared_at: string | null;
  available_from: string;
  available_until: string;
  pickup_place: string;
  pickup_instructions: string;
  ingredients: string;
  allergens: string[];
  allergens_known: boolean;
  handling: string;
};

type RpcError = { message?: string; details?: string } | null;

const codes: Record<string, string> = {
  UNAUTHENTICATED: "Sign in with your university email to continue.",
  FORBIDDEN: "Verify your campus on your account page first.",
  NOT_FOUND: "This food post isn’t available to your account.",
  INVALID_STATE:
    "This post changed, closed or expired. Refresh to see its current state.",
  IDEMPOTENCY_CONFLICT:
    "This request conflicts with an earlier one. Reload and try again.",
};

/** Friendly text for an RPC error; validation errors keep the server's reason. */
export function foodError(error: RpcError): string {
  const code = error?.message ?? "";
  if (code === "VALIDATION_ERROR")
    return error?.details && error.details !== code
      ? `${error.details}.`
      : "Check the highlighted information and try again.";
  return codes[code] ?? "Something went wrong. Please try again.";
}

export const stateLabel: Record<FoodPost["state"], string> = {
  available: "Available now",
  upcoming: "Coming up",
  expired: "Expired",
  closed: "Closed",
  removed: "Removed",
};

export async function loadFoodPosts(
  campusId: string,
  kind: "" | "meal" | "event",
  mine = false,
) {
  const { data, error } = await exchangeClient().rpc("food_posts", {
    campus_id: campusId,
    post_kind: kind,
    mine_only: mine,
  });
  if (error) throw new Error(foodError(error));
  return z.array(foodPostSchema).parse(data);
}

export async function saveFoodPost(
  campusId: string,
  id: string,
  payload: FoodPostInput,
  key: string,
  updatedAt: string | null,
) {
  const { data, error } = await exchangeClient().rpc("save_food_post", {
    campus_id: campusId,
    post_id: id,
    payload,
    idempotency_key: key,
    expected_updated_at: updatedAt,
  });
  if (error) throw new Error(foodError(error));
  return foodPostSchema.parse(data.data);
}

export async function closeFoodPost(id: string) {
  const { data, error } = await exchangeClient().rpc("close_food_post", {
    post_id: id,
    remove: false,
  });
  if (error) throw new Error(foodError(error));
  return foodPostSchema.parse(data);
}

/** datetime-local value (local time, no zone) to ISO, or null when empty. */
export function localToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO to a datetime-local input value in the viewer's time zone. */
export function isoToLocal(iso: string | null, offsetMinutes = 0): string {
  const date = iso
    ? new Date(iso)
    : new Date(Date.now() + offsetMinutes * 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function formatWindow(from: string, until: string): string {
  const f = new Date(from);
  const u = new Date(until);
  const day = (d: Date) =>
    d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return day(f) === day(u)
    ? `${day(f)}, ${time(f)}–${time(u)}`
    : `${day(f)} ${time(f)} – ${day(u)} ${time(u)}`;
}

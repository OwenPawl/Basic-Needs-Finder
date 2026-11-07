import { z } from "zod";
import { errorCode, getSupabaseClient } from "./supabase";

// Typed client for the staff console RPCs
// (prisma/migrations/202611070009_staff_console). Stock actions themselves go
// through src/lib/inventory.ts so there is a single receipt/pickup path.

const lot = z.object({
  lot_id: z.uuid(),
  status: z.enum(["pledged", "received", "removed"]),
  pledged_quantity: z.number().int(),
  on_hand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
});

const dashboard = z.object({
  location: z.object({
    location_id: z.uuid(),
    name: z.string(),
    building: z.string(),
    hours: z.string(),
  }),
  counts: z.object({
    available_units: z.number().int(),
    pending_dropoffs: z.number().int(),
    active_holds: z.number().int(),
    open_requests: z.number().int(),
    completed_exchanges: z.number().int(),
    open_reports: z.number().int(),
  }),
  dropoffs: z.array(
    z.object({
      lot,
      title: z.string(),
      category_id: z.string(),
      is_food: z.boolean(),
      food: z
        .object({
          photo: z.string(),
          date_label: z.string(),
          best_by: z.string(),
          package_status: z.enum(["sealed", "opened"]),
          shelf_stable: z.boolean(),
          storage: z.string(),
          allergens: z.array(z.string()).nullable(),
        })
        .nullable(),
      pledged_at: z.string(),
    }),
  ),
  holds: z.array(
    z.object({
      reservation_id: z.uuid(),
      lot_id: z.uuid(),
      qty: z.number().int(),
      status: z.literal("active"),
      expires_at: z.string(),
      pickup_code: z.string(),
      title: z.string(),
      expired: z.boolean(),
    }),
  ),
  inventory: z.array(
    lot.extend({
      title: z.string(),
      category_id: z.string(),
      best_by: z.string().nullable(),
      past_date: z.boolean(),
    }),
  ),
  recent_events: z.array(
    z.object({
      kind: z.string(),
      lot_id: z.uuid(),
      title: z.string(),
      on_hand_delta: z.number().int(),
      reserved_delta: z.number().int(),
      reason: z.string(),
      by_staff: z.boolean(),
      at: z.string(),
    }),
  ),
  reports: z.array(
    z.object({
      report_id: z.uuid(),
      listing_id: z.uuid(),
      title: z.string(),
      listing_status: z.string(),
      reason: z.string(),
      reported_at: z.string(),
    }),
  ),
  moderation: z.array(
    z.object({
      action: z.enum(["remove_listing", "restore_listing", "dismiss_report"]),
      listing_id: z.uuid(),
      title: z.string(),
      report_id: z.uuid().nullable(),
      reason: z.string(),
      at: z.string(),
    }),
  ),
});

export type StaffDashboard = z.infer<typeof dashboard>;
export type StaffResult<T> =
  { ok: true; value: T } | { ok: false; code: string; message: string };

export function parseStaffDashboard(value: unknown): StaffDashboard {
  return dashboard.parse(value);
}

async function call<T>(
  fn: string,
  args: Record<string, unknown>,
  parse: (value: unknown) => T,
): Promise<StaffResult<T>> {
  const client = getSupabaseClient();
  if (!client)
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "Staff tools aren't connected in this build.",
    };
  const { data, error } = await client.rpc(fn, args);
  if (error)
    return {
      ok: false,
      code: errorCode(error) ?? "UNKNOWN",
      message: error.message,
    };
  return { ok: true, value: parse(data) };
}

export const loadStaffDashboard = (locationId: string) =>
  call("staff_dashboard", { location_id: locationId }, parseStaffDashboard);

export const moderateListing = (
  listingId: string,
  action: "remove" | "restore",
  reason: string,
  reportId?: string,
) =>
  call(
    "moderate_listing",
    {
      listing_id: listingId,
      action,
      reason,
      report_id: reportId ?? null,
    },
    (value) => value,
  );

export const resolveReport = (reportId: string, reason: string) =>
  call("resolve_report", { report_id: reportId, reason }, (value) => value);

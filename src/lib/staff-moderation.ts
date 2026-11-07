import { z } from "zod";
import { exchangeClient } from "./exchange-api";
import { exchangeError } from "./exchange";

// Staff moderation and counts (prisma/migrations/202611070010_staff_moderation).
// Stock actions stay on the exchange_* inventory RPCs. The database checks
// the caller's location assignment on every call.

export const staffCountsSchema = z.object({
  available_units: z.number().int(),
  pending_dropoffs: z.number().int(),
  active_holds: z.number().int(),
  open_requests: z.number().int(),
  completed_exchanges: z.number().int(),
  open_reports: z.number().int(),
});

export const moderationHistorySchema = z.array(
  z.object({
    action: z.enum(["remove_listing", "restore_listing", "dismiss_report"]),
    listing_id: z.uuid(),
    title: z.string(),
    report_id: z.uuid().nullable(),
    reason: z.string(),
    at: z.string(),
  }),
);

export type StaffCounts = z.infer<typeof staffCountsSchema>;
export type ModerationEntry = z.infer<typeof moderationHistorySchema>[number];

export async function loadStaffCounts(locationId: string) {
  const { data, error } = await exchangeClient().rpc("staff_counts", {
    location_id: locationId,
  });
  if (error) throw new Error(exchangeError(error));
  return staffCountsSchema.parse(data);
}

export async function loadModerationHistory(locationId: string) {
  const { data, error } = await exchangeClient().rpc(
    "staff_moderation_history",
    { location_id: locationId },
  );
  if (error) throw new Error(exchangeError(error));
  return moderationHistorySchema.parse(data);
}

/** Remove or restore a listing; removal withdraws its pledged stock. */
export async function moderateListing(
  listingId: string,
  action: "remove" | "restore",
  reason: string,
  reportId?: string,
) {
  const { error } = await exchangeClient().rpc("staff_moderate_listing", {
    listing_id: listingId,
    action,
    reason,
    report_id: reportId ?? null,
  });
  if (error) throw new Error(exchangeError(error));
}

/** Close a report without removing the listing, keeping the reason. */
export async function dismissReport(reportId: string, reason: string) {
  const { error } = await exchangeClient().rpc("staff_dismiss_report", {
    report_id: reportId,
    reason,
  });
  if (error) throw new Error(exchangeError(error));
}

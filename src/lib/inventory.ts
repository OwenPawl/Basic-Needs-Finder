import { z } from "zod";
import { errorCode, getSupabaseClient } from "./supabase";

// Typed client for the authenticated inventory RPCs
// (prisma/migrations/202611070007_inventory_rpc). The database resolves the
// caller from the Supabase session and re-checks every permission; nothing
// here is authorization. Reuse the same idempotency key when retrying a
// request so the server replays the original outcome.

const lot = z.object({
  lot_id: z.uuid(),
  status: z.enum(["pledged", "received", "removed"]),
  pledged_quantity: z.number().int(),
  on_hand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
});

const reservation = z.object({
  reservation_id: z.uuid(),
  lot_id: z.uuid(),
  student_id: z.uuid(),
  qty: z.number().int(),
  status: z.enum(["active", "completed", "cancelled", "expired"]),
  expires_at: z.string(),
});

const envelope = z.union([
  z.object({
    ok: z.literal(true),
    replayed: z.boolean().optional(),
    data: z.object({
      lot: lot.optional(),
      reservation: reservation.optional(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    replayed: z.boolean().optional(),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export type StockLot = z.infer<typeof lot>;
export type Reservation = z.infer<typeof reservation>;
export type InventoryResult =
  | { ok: true; lot?: StockLot; reservation?: Reservation; replayed: boolean }
  | { ok: false; code: string; message: string };

const NOT_CONNECTED: InventoryResult = {
  ok: false,
  code: "UNAVAILABLE",
  message: "Live inventory isn't connected in this build.",
};

/** Parse an RPC envelope; exported for tests. */
export function parseInventoryResult(value: unknown): InventoryResult {
  const result = envelope.parse(value);
  return result.ok
    ? { ok: true, ...result.data, replayed: Boolean(result.replayed) }
    : { ok: false, code: result.error.code, message: result.error.message };
}

async function call(
  fn: string,
  args: Record<string, unknown>,
): Promise<InventoryResult> {
  const client = getSupabaseClient();
  if (!client) return NOT_CONNECTED;
  const { data, error } = await client.rpc(fn, args);
  if (error)
    return {
      ok: false,
      code: errorCode(error) ?? "UNKNOWN",
      message: error.message,
    };
  return parseInventoryResult(data);
}

export const newIdempotencyKey = () => crypto.randomUUID();

export const reserveItem = (lotId: string, qty: number, key: string) =>
  call("reserve_item", { lot_id: lotId, qty, idempotency_key: key });

export const cancelReservation = (reservationId: string, key: string) =>
  call("cancel_reservation", {
    reservation_id: reservationId,
    idempotency_key: key,
  });

export const confirmReceipt = (lotId: string, qty: number, key: string) =>
  call("confirm_receipt", { lot_id: lotId, qty, idempotency_key: key });

export const confirmPickup = (reservationId: string, key: string) =>
  call("confirm_pickup", {
    reservation_id: reservationId,
    idempotency_key: key,
  });

export const correctStock = (
  lotId: string,
  onHand: number,
  reason: string,
  key: string,
) =>
  call("correct_stock", {
    lot_id: lotId,
    on_hand: onHand,
    reason,
    idempotency_key: key,
  });

export const removeStock = (lotId: string, reason: string, key: string) =>
  call("remove_stock", { lot_id: lotId, reason, idempotency_key: key });

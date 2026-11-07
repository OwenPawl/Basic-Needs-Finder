import { describe, expect, it } from "vitest";
import { parseInventoryResult } from "../src/lib/inventory";

const lot = {
  lot_id: "00000000-0000-4000-8000-000000001100",
  status: "received",
  pledged_quantity: 2,
  on_hand: 2,
  reserved: 1,
  available: 1,
};

describe("parseInventoryResult", () => {
  it("unwraps a successful envelope", () => {
    expect(parseInventoryResult({ ok: true, data: { lot } })).toEqual({
      ok: true,
      lot,
      replayed: false,
    });
  });

  it("keeps the replay flag for retried idempotency keys", () => {
    expect(
      parseInventoryResult({ ok: true, replayed: true, data: { lot } }),
    ).toMatchObject({ replayed: true });
  });

  it("surfaces API_CONTRACT error codes", () => {
    expect(
      parseInventoryResult({
        ok: false,
        error: {
          code: "INSUFFICIENT_STOCK",
          message: "Not enough units are available.",
        },
      }),
    ).toEqual({
      ok: false,
      code: "INSUFFICIENT_STOCK",
      message: "Not enough units are available.",
    });
  });

  it("rejects malformed responses instead of guessing", () => {
    expect(() =>
      parseInventoryResult({
        ok: true,
        data: { lot: { ...lot, status: "available" } },
      }),
    ).toThrow();
  });
});

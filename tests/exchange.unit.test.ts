import { describe, it, expect } from "vitest";
import {
  listingInputSchema,
  listingState,
  type ExchangeListing,
} from "../src/lib/exchange";
const valid = {
  kind: "offer",
  title: "Winter jacket",
  description: "A clean warm winter jacket.",
  category_id: "clothing",
  location_id: "00000000-0000-4000-8000-000000000010",
  quantity: 1,
  images: ["own/real-photo.jpg"],
  food: null,
};
describe("goods posting rules", () => {
  it("requires offer photo and quantity but permits requests without either", () => {
    expect(
      listingInputSchema.safeParse({ ...valid, images: [], quantity: null })
        .success,
    ).toBe(false);
    expect(
      listingInputSchema.safeParse({
        ...valid,
        kind: "request",
        images: [],
        quantity: null,
      }).success,
    ).toBe(true);
  });
  it("requires food information and keeps rides out of goods stock", () => {
    expect(
      listingInputSchema.safeParse({ ...valid, category_id: "food" }).success,
    ).toBe(false);
    expect(
      listingInputSchema.safeParse({ ...valid, category_id: "transportation" })
        .success,
    ).toBe(false);
  });
  it("never labels a pledge available even when its count is positive", () => {
    const row = {
      status: "open",
      kind: "offer",
      lots: [
        {
          status: "pledged",
          pledged_quantity: 3,
          on_hand: 0,
          reserved: 0,
          available: 3,
        },
      ],
    } as ExchangeListing;
    expect(listingState(row).label).toBe("Awaiting drop-off");
    expect(listingState({ ...row, kind: "request" }).label).toBe(
      "Community request",
    );
    expect(
      listingState({
        ...row,
        lots: [
          {
            ...row.lots[0],
            status: "received",
            on_hand: 2,
            reserved: 2,
            available: 0,
          },
        ],
      }).label,
    ).toBe("Currently reserved");
  });
});

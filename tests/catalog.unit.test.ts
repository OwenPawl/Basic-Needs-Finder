import { describe, expect, it } from "vitest";
import {
  catalogSchema,
  filterResources,
  stockAvailability,
  type CatalogFilters,
} from "../src/lib/catalog";
import data from "../src/data/catalog.json";
const catalog = catalogSchema.parse(data);
const defaults: CatalogFilters = {
  query: "",
  category: "",
  location: "",
  kind: "ALL",
  availableOnly: false,
  sort: "recent",
};
describe("student discovery", () => {
  it("never presents pledges, reserved items, or requests as available", () => {
    const result = filterResources(catalog.resources, {
      ...defaults,
      availableOnly: true,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every(
        (item) =>
          item.kind === "OFFER" &&
          item.status === "AVAILABLE" &&
          item.available > 0,
      ),
    ).toBe(true);
    expect(
      result.some((item) => /jacket|calculator|lamp/i.test(item.title)),
    ).toBe(false);
  });
  it("combines search, category, location and post-type filters", () => {
    const item = catalog.resources.find((item) =>
      item.title.includes("Notebooks"),
    )!;
    expect(
      filterResources(catalog.resources, {
        ...defaults,
        query: "  NOTEBOOK  ",
        category: "supplies",
        location: item.locationId,
        kind: "OFFER",
      }).map((value) => value.id),
    ).toEqual([item.id]);
    expect(
      filterResources(catalog.resources, {
        ...defaults,
        query: "notebook",
        category: "food",
      }),
    ).toEqual([]);
  });
  it("keeps requests discoverable without treating them as stock", () => {
    const requests = filterResources(catalog.resources, {
      ...defaults,
      kind: "REQUEST",
    });
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.available === 0)).toBe(true);
  });
  it("returns an empty result instead of arbitrary fallback inventory", () => {
    expect(
      filterResources(catalog.resources, {
        ...defaults,
        query: "no-such-resource",
      }),
    ).toEqual([]);
  });
  it("exports only an allowlisted public demo shape", () => {
    expect(catalog.campus.isDemo).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(
      /"(?:email|authSubject|authorId|password|memberId|messages)"/,
    );
  });
});
describe("stock display boundary", () => {
  it("only counts physically received, unreserved units", () => {
    expect(stockAvailability("PLEDGED", 0, 0)).toBe(0);
    expect(stockAvailability("RECEIVED", 6, 1)).toBe(5);
    expect(stockAvailability("RECEIVED", 1, 1)).toBe(0);
    expect(stockAvailability("REMOVED", 5, 0)).toBe(0);
  });
  it("rejects corrupt counter values", () => {
    expect(() => stockAvailability("RECEIVED", 1, 2)).toThrow();
    expect(() => stockAvailability("RECEIVED", -1, 0)).toThrow();
    expect(() => stockAvailability("RECEIVED", 1.5, 0)).toThrow();
  });
});

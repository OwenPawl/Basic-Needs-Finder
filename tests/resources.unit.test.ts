import { describe, expect, it } from "vitest";
import data from "../src/data/wwu-resources.json";
import {
  filterDirectory,
  resourcePlanText,
  resourceSchema,
} from "../src/lib/resources";
import { readFileSync } from "node:fs";
const resources = resourceSchema.array().parse(data);
const defaults = { query: "", area: "", category: "", day: "" };
describe("public WWU directory", () => {
  it("combines campus, type, service day and multi-word search", () => {
    const result = filterDirectory(resources, {
      query: "  MILLER food  ",
      area: "campus",
      category: "pantry",
      day: "1",
    });
    expect(result.map((r) => r.id)).toEqual(["ceed"]);
    expect(
      filterDirectory(resources, {
        ...defaults,
        area: "community",
        query: "Miller",
      }),
    ).toEqual([]);
  });
  it("treats Sunday as a real day and excludes unspecified schedules", () => {
    expect(
      filterDirectory(resources, { ...defaults, area: "campus", day: "0" }),
    ).toEqual([]);
    const r = { ...resources[0], id: "sunday-fixture", days: [0] };
    expect(filterDirectory([r], { ...defaults, day: "0" })).toEqual([r]);
    expect(
      filterDirectory([{ ...r, days: [] }], { ...defaults, day: "0" }),
    ).toEqual([]);
    expect(filterDirectory([{ ...r, days: [] }], defaults)).toHaveLength(1);
  });
  it("exports only selected resources with source, access and directions", () => {
    const whole = resources.find((r) => r.id === "whole")!;
    const text = resourcePlanText([whole]);
    expect(text).toContain(whole.title);
    expect(text).toContain(whole.access);
    expect(text).toContain(whole.source);
    expect(text).toContain(whole.directions);
    expect(text).toContain(whole.checked);
    expect(text).not.toContain(resources.find((r) => r.id === "ceed")!.title);
    expect(text).toContain("Confirm hours");
  });
  it("keeps fixture catalog out of the public entry point and ships no image fields", () => {
    const entry = readFileSync(
      new URL("../src/app/page.tsx", import.meta.url),
      "utf8",
    );
    expect(entry).toContain("wwu-resources.json");
    expect(entry).not.toMatch(/catalog|campus-browser/);
    expect(new Set(resources.map((r) => r.id)).size).toBe(resources.length);
    expect(JSON.stringify(data)).not.toMatch(
      /illustrations|image_url|photo|students\.example\.invalid/,
    );
  });
});

import { z } from "zod";
const httpsUrl = z
  .string()
  .url()
  .refine((url) => url.startsWith("https://"));
export const resourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  provider: z.string(),
  category: z.enum(["pantry", "meals", "benefits", "support"]),
  area: z.enum(["campus", "community", "online"]),
  place: z.string(),
  summary: z.string(),
  hours: z.string(),
  days: z.array(z.number().int().min(0).max(6)),
  access: z.string(),
  note: z.string(),
  source: httpsUrl,
  checked: z.iso.date(),
  directions: httpsUrl.nullable(),
  action: z.object({ label: z.string(), url: httpsUrl }).nullable(),
});
export type CampusResource = z.infer<typeof resourceSchema>;
export type ResourceFilters = {
  query: string;
  category: string;
  area: string;
  day: string;
};
export const categories = [
  { id: "", label: "All resources" },
  { id: "pantry", label: "Food & groceries" },
  { id: "meals", label: "Meal programs" },
  { id: "benefits", label: "SNAP & benefits" },
  { id: "support", label: "Emergency support" },
];
export const areaNames = {
  campus: "On campus",
  community: "Bellingham",
  online: "Online / countywide",
};
export const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function filterDirectory(
  resources: CampusResource[],
  filters: ResourceFilters,
) {
  const terms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return resources.filter(
    (r) =>
      (!filters.category || r.category === filters.category) &&
      (!filters.area || r.area === filters.area) &&
      (!filters.day || r.days.includes(Number(filters.day))) &&
      terms.every((term) =>
        [r.title, r.provider, r.place, r.summary, r.access]
          .join(" ")
          .toLowerCase()
          .includes(term),
      ),
  );
}
export function resourcePlanText(resources: CampusResource[]) {
  return [
    "VIKING TABLE — WWU & BELLINGHAM",
    "Listed hours are not a stock guarantee. Confirm hours and holiday closures with the provider.",
    ...resources.map(
      (r) =>
        `\n${r.title}\n${r.place}\n${r.hours}\n${r.access}\n${r.note}\nSource (checked ${r.checked}): ${r.source}${r.directions ? `\nDirections: ${r.directions}` : ""}${r.action ? `\n${r.action.label}: ${r.action.url}` : ""}`,
    ),
    "\nCampus map: https://map.wwu.edu/\nWTA trip planner: https://schedules.ridewta.com/",
  ].join("\n");
}

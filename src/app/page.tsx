import { CampusBrowser } from "@/components/campus-browser";
import catalogData from "@/data/catalog.json";
import { catalogSchema } from "@/lib/catalog";

export default function Home() {
  return <CampusBrowser catalog={catalogSchema.parse(catalogData)} />;
}

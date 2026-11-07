import { ResourceFinder } from "@/components/resource-finder";
import resources from "@/data/wwu-resources.json";
import { resourceSchema } from "@/lib/resources";
export default function Home() {
  return <ResourceFinder resources={resourceSchema.array().parse(resources)} />;
}

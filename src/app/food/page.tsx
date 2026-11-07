import type { Metadata } from "next";
import { FoodPosts } from "@/components/food-posts";

export const metadata: Metadata = {
  title: "Homemade food & free-food events · Basic Needs Finder",
  description:
    "Students share extra home-cooked meals and free-food events at Western.",
  robots: { index: false, follow: false },
};

export default function FoodPage() {
  return <FoodPosts />;
}

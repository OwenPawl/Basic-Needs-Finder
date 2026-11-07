import type { Metadata } from "next";
import { StaffConsole } from "@/components/staff-console";

export const metadata: Metadata = {
  title: "Staff console · Basic Needs Finder",
  description:
    "Confirm drop-offs and pickups, manage inventory, and review reports for your campus location.",
  robots: { index: false, follow: false },
};

export default function StaffPage() {
  return <StaffConsole />;
}

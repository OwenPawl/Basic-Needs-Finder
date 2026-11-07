import type { Metadata } from "next";
import { Inbox } from "@/components/inbox";

export const metadata: Metadata = {
  title: "Messages · Basic Needs Finder",
  description: "Private messages about campus exchange listings.",
  robots: { index: false, follow: false },
};

export default function InboxPage() {
  return <Inbox />;
}

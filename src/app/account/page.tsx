import type { Metadata } from "next";
import { Account } from "@/components/account";

export const metadata: Metadata = {
  title: "Your account · Viking Table",
  description: "Sign in with your university email to use the campus exchange.",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <Account />;
}

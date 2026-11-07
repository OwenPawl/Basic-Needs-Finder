import type { Metadata } from "next";
import { assetPath } from "@/lib/catalog";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viking Table · WWU & Bellingham",
  icons: { icon: { url: assetPath("/viking-table.svg"), type: "image/svg+xml" } },
  description:
    "Find food pantries, grocery support, SNAP application help, and emergency food resources for Western Washington University students.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

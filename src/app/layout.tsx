import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Basic Needs Finder · A little help, close to home",
  description:
    "Find and share everyday essentials with your campus community. Explore the fictional campus demo.",
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

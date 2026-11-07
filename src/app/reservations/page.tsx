import { Suspense } from "react";
import { ExchangeOperations } from "@/components/exchange-operations";
export const metadata = { title: "Reservations · Basic Needs Finder" };
export default function Page() {
  return (
    <Suspense fallback={<p>Opening reservations…</p>}>
      <ExchangeOperations />
    </Suspense>
  );
}

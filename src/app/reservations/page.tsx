import { Suspense } from "react";
import { ExchangeOperations } from "@/components/exchange-operations";
export const metadata = { title: "Reservations · Viking Table" };
export default function Page() {
  return (
    <Suspense fallback={<p>Opening reservations…</p>}>
      <ExchangeOperations />
    </Suspense>
  );
}

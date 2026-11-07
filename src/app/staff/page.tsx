import { Suspense } from "react";
import { ExchangeOperations } from "@/components/exchange-operations";
export const metadata = { title: "Staff inventory · Viking Table" };
export default function Page() {
  return (
    <Suspense fallback={<p>Opening staff inventory…</p>}>
      <ExchangeOperations staff />
    </Suspense>
  );
}

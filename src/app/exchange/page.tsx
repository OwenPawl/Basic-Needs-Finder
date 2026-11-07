import { Suspense } from "react";
import { GoodsExchange } from "@/components/goods-exchange";
export const metadata = { title: "Give & find goods · Viking Table" };
export default function ExchangePage() {
  return (
    <Suspense
      fallback={
        <main className="exchange-page">
          <p>Opening the community exchange…</p>
        </main>
      }
    >
      <GoodsExchange />
    </Suspense>
  );
}

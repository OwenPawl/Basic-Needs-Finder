import { assetPath } from "@/lib/catalog";

/** Decorative alongside the visible Viking Table wordmark. */
export function BrandMark() {
  return (
    <img
      className="brand-mark"
      src={assetPath("/viking-table.svg")}
      width={48}
      height={48}
      alt=""
      aria-hidden="true"
    />
  );
}

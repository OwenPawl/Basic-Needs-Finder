"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Package, RefreshCw } from "lucide-react";
import {
  loadExchangeCatalog,
  loadExchangeListing,
  signListingPhotos,
} from "@/lib/exchange-api";
import {
  exchangeError,
  type ExchangeCatalog,
  type ExchangeListing,
} from "@/lib/exchange";
import { getSupabaseClient } from "@/lib/supabase";
import "./goods-exchange.css";
import "./exchange-operations.css";
type Reservation = {
  reservation_id: string;
  lot_id: string;
  quantity: number;
  status: string;
  expires_at: string;
  title: string;
  listing_id: string;
  location: {
    id: string;
    name: string;
    building: string;
    hours: string;
    instructions: string;
  };
};
type Lot = {
  lot_id: string;
  status: string;
  pledged_quantity: number;
  on_hand: number;
  reserved: number;
  available: number;
  title: string;
  listing_id: string;
  location_id: string;
  food: ExchangeListing["food"];
  images: string[];
};
type Report = {
  id: string;
  title: string;
  reason: string;
  listing_id: string;
  resolved_at: string | null;
};
type ModerationEntry = {
  action: "remove_listing" | "restore_listing" | "dismiss_report";
  listing_id: string;
  title: string;
  reason: string;
  at: string;
};
// Moderation RPCs (202611070011_staff_moderation) take no idempotency key.
const UNKEYED = new Set([
  "exchange_resolve_report",
  "staff_moderate_listing",
  "staff_dismiss_report",
]);
type StaffData = {
  lots: Lot[];
  reservations: Reservation[];
  locations: ExchangeCatalog["locations"];
  reports: Report[];
};
export function ExchangeOperations({ staff = false }: { staff?: boolean }) {
  const params = useSearchParams();
  const [catalog, setCatalog] = useState<ExchangeCatalog | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [stock, setStock] = useState<StaffData | null>(null);
  const [listing, setListing] = useState<ExchangeListing | null>(null);
  const [photos, setPhotos] = useState(new Map<string, string>());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<ModerationEntry[]>([]);
  const keys = useRef(new Map<string, string>());
  const running = useRef(false);
  const reload = useCallback(async () => {
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error("Exchange setup is still in progress.");
      const { data: auth, error: sessionError } =
        await client.auth.getSession();
      if (sessionError)
        throw new Error("We couldn't check your sign-in. Please try again.");
      if (!auth.session) {
        setCatalog(null);
        setReservations([]);
        setStock(null);
        setListing(null);
        setPhotos(new Map());
        throw new Error(
          "Sign in with your WWU email to view your reservations and pickups.",
        );
      }
      const cat = await loadExchangeCatalog();
      setCatalog(cat);
      if (staff) {
        const r = await client.rpc("exchange_staff_inventory", {
          campus_id: cat.campus.id,
        });
        if (r.error) throw new Error(exchangeError(r.error));
        setStock(r.data as StaffData);
        const logs = await Promise.all(
          (r.data as StaffData).locations.map((p) =>
            client.rpc("staff_moderation_history", { location_id: p.id }),
          ),
        );
        setHistory(
          logs
            .flatMap((h) => (h.error ? [] : (h.data as ModerationEntry[])))
            .sort((a, b) => b.at.localeCompare(a.at))
            .slice(0, 20),
        );
        setPhotos(
          await signListingPhotos(
            (r.data as StaffData).lots.flatMap((l) => l.images),
          ),
        );
      } else {
        const r = await client.rpc("exchange_my_reservations", {
          campus_id: cat.campus.id,
        });
        if (r.error) throw new Error(exchangeError(r.error));
        setReservations(r.data as Reservation[]);
        const id = params.get("listing");
        if (id) setListing(await loadExchangeListing(id));
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this page.");
    } finally {
      setLoading(false);
    }
  }, [params, staff]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function command(
    name: string,
    args: Record<string, unknown>,
    success: string,
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const identity = name + JSON.stringify(args);
    let key = keys.current.get(identity);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(identity, key);
    }
    try {
      const result = await getSupabaseClient()!.rpc(name, {
        ...args,
        ...(UNKEYED.has(name) ? {} : { idempotency_key: key }),
      });
      if (result.error) throw new Error(exchangeError(result.error));
      if (result.data?.error) {
        keys.current.delete(identity);
        throw new Error(exchangeError({ message: result.data.error.code }));
      }
      keys.current.delete(identity);
      setNotice(success);
      await reload();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The action was not confirmed. Please retry.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const qty = (id: string, fallback: number) => quantities[id] ?? fallback;
  const number = (id: string, fallback: number, max: number) => (
    <input
      aria-label="Quantity"
      type="number"
      min={1}
      max={max}
      value={qty(id, fallback)}
      onChange={(e) =>
        setQuantities((q) => ({ ...q, [id]: Number(e.target.value) }))
      }
    />
  );
  const active = staff ? (stock?.reservations ?? []) : reservations;
  return (
    <main className="operations-page">
      <Link href="/exchange/" className="goods-text-button operations-back">
        <ArrowLeft size={17} />
        Back to goods
      </Link>
      <header className="operations-heading">
        <div>
          <p className="eyebrow">
            {staff ? "ASSIGNED LOCATION STAFF" : "YOUR CAMPUS EXCHANGES"}
          </p>
          <h1>{staff ? "Inventory & pickups" : "Your reservations"}</h1>
          <p>
            {staff
              ? "Record only the items physically received or handed to a student."
              : "Reserve received items, check collection instructions, or release a hold."}
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => void reload()}
          disabled={busy}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>
      <nav className="operations-nav">
        <Link href="/exchange/">Offers & requests</Link>
        <Link href="/reservations/">Reservations</Link>
        <Link href="/inbox/">Messages</Link>
        <Link href="/account/">My account</Link>
        {staff && <span>Staff console</span>}
      </nav>
      {error && (
        <div className="goods-error" role="alert">
          {error} <Link href="/account/">Check your account →</Link>
        </div>
      )}
      {notice && (
        <p className="goods-notice" role="status">
          {notice}
        </p>
      )}
      {loading && <p role="status">Loading…</p>}
      {!staff && listing && (
        <section className="operations-reserve">
          <h2>{listing.title}</h2>
          <p>
            {listing.location.name} · {listing.location.building}
          </p>
          {listing.lots
            .filter((l) => l.status === "received" && l.available > 0)
            .map((l) => (
              <form
                key={l.lot_id}
                onSubmit={(e) => {
                  e.preventDefault();
                  void command(
                    "exchange_reserve",
                    { lot_id: l.lot_id, qty: qty(l.lot_id, 1) },
                    "Reserved. Check your pickup details below.",
                  );
                }}
              >
                <label>
                  Quantity ({l.available} available)
                  {number(l.lot_id, 1, l.available)}
                </label>
                <button className="button primary" disabled={busy}>
                  Reserve for pickup
                </button>
              </form>
            ))}
          {!listing.lots.some(
            (l) => l.status === "received" && l.available > 0,
          ) && (
            <p>
              No received units are available right now. Refresh to check again.
            </p>
          )}
        </section>
      )}
      {staff && stock && (
        <>
          <div className="operations-counts">
            <div>
              <strong>{stock.lots.reduce((n, l) => n + l.available, 0)}</strong>
              <span>Available items</span>
            </div>
            <div>
              <strong>
                {stock.lots.filter((l) => l.status === "pledged").length}
              </strong>
              <span>Awaiting receipt</span>
            </div>
            <div>
              <strong>
                {
                  stock.reservations.filter((r) => r.status === "completed")
                    .length
                }
              </strong>
              <span>Completed pickups</span>
            </div>
          </div>
          <h2>Stock at your assigned desks</h2>
          <p className="operations-help">
            Inspect the actual item and food date/package before confirming
            receipt. A post alone is not proof of delivery.
          </p>
          <div className="operations-grid">
            {stock.lots.map((l) => (
              <article key={l.lot_id} className="operations-card">
                {l.images[0] && photos.get(l.images[0]) && (
                  <img src={photos.get(l.images[0])} alt={l.title} />
                )}
                <h3>{l.title}</h3>
                <p>
                  {stock.locations.find((p) => p.id === l.location_id)?.name} ·{" "}
                  {l.status}
                </p>
                <p>
                  {l.on_hand} on hand · {l.reserved} reserved · {l.available}{" "}
                  available
                </p>
                {l.food && (
                  <div className="goods-food">
                    <p>
                      {l.food.food_name} · {l.food.best_by}
                    </p>
                    <p>
                      {l.food.opened ? "Opened" : "Sealed"} ·{" "}
                      {l.food.shelf_stable ? "Shelf-stable" : "Perishable"}
                    </p>
                    <p>Storage: {l.food.storage}</p>
                    <p>
                      Allergens:{" "}
                      {l.food.allergens_known
                        ? l.food.allergens.join(", ") || "None listed"
                        : "Unknown"}
                    </p>
                  </div>
                )}
                {l.status === "pledged" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void command(
                        "exchange_receive",
                        {
                          lot_id: l.lot_id,
                          qty: qty(l.lot_id, l.pledged_quantity),
                        },
                        "Receipt recorded. Stock is now available.",
                      );
                    }}
                  >
                    <label>
                      Units physically received
                      {number(l.lot_id, l.pledged_quantity, l.pledged_quantity)}
                    </label>
                    <button disabled={busy} className="button primary">
                      Confirm receipt
                    </button>
                  </form>
                )}
                {l.status !== "removed" && (
                  <details>
                    <summary>Correct or remove stock</summary>
                    <label>
                      Reason (required)
                      <input
                        value={reasons[l.lot_id] ?? ""}
                        onChange={(e) =>
                          setReasons((r) => ({
                            ...r,
                            [l.lot_id]: e.target.value,
                          }))
                        }
                      />
                    </label>
                    {l.status === "received" && (
                      <label>
                        Correct on-hand count
                        <input
                          type="number"
                          min={l.reserved}
                          value={qty("correct-" + l.lot_id, l.on_hand)}
                          onChange={(e) =>
                            setQuantities((q) => ({
                              ...q,
                              ["correct-" + l.lot_id]: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    )}
                    <div className="operations-buttons">
                      {l.status === "received" && (
                        <button
                          className="button secondary"
                          disabled={busy || !reasons[l.lot_id]?.trim()}
                          onClick={() =>
                            void command(
                              "exchange_correct",
                              {
                                lot_id: l.lot_id,
                                on_hand: qty("correct-" + l.lot_id, l.on_hand),
                                reason: reasons[l.lot_id],
                              },
                              "Correction recorded.",
                            )
                          }
                        >
                          Record correction
                        </button>
                      )}
                      <button
                        className="button secondary"
                        disabled={busy || !reasons[l.lot_id]?.trim()}
                        onClick={() =>
                          void command(
                            "exchange_remove",
                            { lot_id: l.lot_id, reason: reasons[l.lot_id] },
                            "Stock removed and holds released.",
                          )
                        }
                      >
                        Remove stock
                      </button>
                    </div>
                  </details>
                )}
              </article>
            ))}
          </div>
          {!stock.lots.length && (
            <p className="goods-state">
              No goods have been offered at your assigned desks yet.
            </p>
          )}
        </>
      )}
      {!loading && catalog && (!staff || stock) && (
        <section className="operations-reservations">
          <h2>{staff ? "Student pickups" : "Reservation history"}</h2>
          {!active.length && (
            <div className="goods-state">
              <Package size={28} />
              <p>No reservations yet.</p>
              <Link href="/exchange/" className="button primary">
                Browse goods
              </Link>
            </div>
          )}
          <div className="operations-grid">
            {active.map((r) => (
              <article key={r.reservation_id} className="operations-card">
                <h3>{r.title}</h3>
                <p>
                  <strong>
                    {r.quantity} item{r.quantity === 1 ? "" : "s"} · {r.status}
                  </strong>
                </p>
                <p>
                  {r.location.name} · {r.location.building}
                </p>
                <p>{r.location.hours}</p>
                <p>{r.location.instructions}</p>
                <p>Hold deadline: {new Date(r.expires_at).toLocaleString()}</p>
                <p className="operations-id">Reservation: {r.reservation_id}</p>
                {r.status === "active" && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void command(
                        staff ? "exchange_pickup" : "exchange_cancel",
                        { reservation_id: r.reservation_id },
                        staff
                          ? "Pickup confirmed."
                          : "Reservation cancelled; the items are available again.",
                      )
                    }
                  >
                    {staff
                      ? "Confirm handoff to student"
                      : "Cancel reservation"}
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {staff && stock && (
        <section className="operations-reservations">
          <h2>Listing reports</h2>
          {stock.reports
            .filter((r) => !r.resolved_at)
            .map((r) => (
              <article className="operations-card" key={r.id}>
                <h3>{r.title}</h3>
                <p>{r.reason}</p>
                <Link href={`/exchange/?listing=${r.listing_id}`}>
                  View listing
                </Link>
                <label>
                  Decision reason
                  <input
                    value={reasons[`report:${r.id}`] ?? ""}
                    minLength={3}
                    maxLength={500}
                    onChange={(e) =>
                      setReasons((x) => ({
                        ...x,
                        [`report:${r.id}`]: e.target.value,
                      }))
                    }
                  />
                </label>
                <div className="operations-buttons">
                  <button
                    className="button"
                    disabled={
                      busy ||
                      (reasons[`report:${r.id}`] ?? "").trim().length < 3
                    }
                    onClick={() =>
                      void command(
                        "staff_moderate_listing",
                        {
                          listing_id: r.listing_id,
                          action: "remove",
                          reason: (reasons[`report:${r.id}`] ?? "").trim(),
                          report_id: r.id,
                        },
                        "Listing removed, its stock withdrawn, and the report closed.",
                      )
                    }
                  >
                    Remove listing
                  </button>
                  <button
                    className="button secondary"
                    disabled={
                      busy ||
                      (reasons[`report:${r.id}`] ?? "").trim().length < 3
                    }
                    onClick={() =>
                      void command(
                        "staff_dismiss_report",
                        {
                          report_id: r.id,
                          reason: (reasons[`report:${r.id}`] ?? "").trim(),
                        },
                        "Report dismissed with your reason.",
                      )
                    }
                  >
                    Dismiss report
                  </button>
                </div>
              </article>
            ))}
          {!stock.reports.some((r) => !r.resolved_at) && (
            <p>No unresolved reports at your assigned desks.</p>
          )}
          {history.length > 0 && (
            <>
              <h3>Recent moderation</h3>
              <ul className="operations-history">
                {history.map((h, i) => (
                  <li key={`${h.listing_id}-${h.at}-${i}`}>
                    {new Date(h.at).toLocaleString()} ·{" "}
                    {h.action === "dismiss_report"
                      ? "Report dismissed"
                      : h.action === "remove_listing"
                        ? "Listing removed"
                        : "Listing restored"}{" "}
                    · {h.title}: {h.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}

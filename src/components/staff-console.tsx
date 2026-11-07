"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { parseSession } from "@/lib/session";
import {
  confirmPickup,
  confirmReceipt,
  cancelReservation,
  correctStock,
  newIdempotencyKey,
  removeStock,
  type InventoryResult,
} from "@/lib/inventory";
import {
  loadStaffDashboard,
  moderateListing,
  resolveReport,
  type StaffDashboard,
  type StaffResult,
} from "@/lib/staff";
import styles from "./staff-console.module.css";

// Staff console for one pickup location. Every action is authorized again in
// the database; this page only decides what to show.

type Step = "loading" | "unavailable" | "signed-out" | "not-staff" | "ready";
type Place = { id: string; name: string };

const messages: Record<string, string> = {
  UNAUTHENTICATED: "Your sign-in expired. Please sign in again.",
  FORBIDDEN: "You aren't assigned to this location for that action.",
  NOT_FOUND: "That item is no longer available here.",
  VALIDATION_ERROR: "Please check the quantity, reason, or food details.",
  INVALID_STATE: "Someone already handled this. The list has been refreshed.",
  INSUFFICIENT_STOCK: "There aren't enough units for that.",
  NOT_RESERVABLE: "This item can't be reserved.",
  RESERVATION_EXPIRED:
    "This hold expired, so its unit has been released back to stock.",
  WOULD_VIOLATE_RESERVATIONS:
    "Stock can't go below the number of units already held. Resolve those holds first.",
  IDEMPOTENCY_CONFLICT:
    "That request changed while it was being retried. Please try again.",
};

const friendly = (code: string, fallback: string) => messages[code] ?? fallback;

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export function StaffConsole() {
  const [step, setStep] = useState<Step>("loading");
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeId, setPlaceId] = useState("");
  const [board, setBoard] = useState<StaffDashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  // Reuse a key until its action succeeds so a retry replays, not repeats.
  const keys = useRef(new Map<string, string>());
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return setStep("unavailable");
    void (async () => {
      const { data: auth } = await client.auth.getSession();
      if (!auth.session) return setStep("signed-out");
      const { data, error: rpcError } = await client.rpc("my_session");
      if (rpcError) return setStep("signed-out");
      const ids = parseSession(data).memberships.flatMap(
        (m) => m.staff_location_ids,
      );
      if (ids.length === 0) return setStep("not-staff");
      const { data: rows } = await client
        .from("Location")
        .select("id,name")
        .in("id", ids)
        .order("name");
      const list =
        (rows as Place[] | null) ?? ids.map((id) => ({ id, name: id }));
      setPlaces(list);
      setPlaceId(list[0].id);
      setStep("ready");
    })();
  }, []);

  const refresh = useCallback(async (id: string) => {
    const result = await loadStaffDashboard(id);
    if (result.ok) setBoard(result.value);
    else setError(friendly(result.code, "We couldn't load this location."));
  }, []);

  useEffect(() => {
    if (placeId) void refresh(placeId);
  }, [placeId, refresh]);

  useEffect(() => {
    if (step === "ready" && board)
      heading.current?.focus({ preventScroll: true });
  }, [step, board?.location.location_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(
    id: string,
    done: string,
    run: (key: string) => Promise<InventoryResult | StaffResult<unknown>>,
  ) {
    setBusy(true);
    setError("");
    setStatus("");
    const key = keys.current.get(id) ?? newIdempotencyKey();
    keys.current.set(id, key);
    try {
      const result = await run(key);
      if (result.ok) {
        keys.current.delete(id);
        setStatus(done);
      } else {
        if (result.code !== "UNKNOWN" && result.code !== "UNAVAILABLE")
          keys.current.delete(id);
        setError(friendly(result.code, result.message));
      }
      await refresh(placeId);
    } finally {
      setBusy(false);
    }
  }

  function reasonFrom(form: HTMLFormElement) {
    return String(new FormData(form).get("reason") ?? "").trim();
  }

  if (step === "loading")
    return (
      <main className={styles.page}>
        <p role="status">Loading staff tools…</p>
      </main>
    );
  if (step !== "ready")
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <h1>Staff console</h1>
          <p>
            {step === "unavailable" &&
              "Staff tools aren't connected in this build yet. No live inventory is shown."}
            {step === "signed-out" &&
              "Sign in with your university email to use staff tools."}
            {step === "not-staff" &&
              "This page is for staff assigned to a campus pickup location. Ask a campus admin to assign you."}
          </p>
          <a className={styles.link} href="../account/">
            Go to your account
          </a>
        </section>
      </main>
    );

  const c = board?.counts;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 ref={heading} tabIndex={-1}>
          Staff console{board ? ` · ${board.location.name}` : ""}
        </h1>
        {places.length > 1 && (
          <label className={styles.picker}>
            Location
            <select
              value={placeId}
              onChange={(e) => setPlaceId(e.target.value)}
              disabled={busy}
            >
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <div aria-live="polite" className={styles.live}>
        {status && <p className={styles.ok}>{status}</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      {!board ? (
        <p role="status">Loading location…</p>
      ) : (
        <>
          <section aria-labelledby="counts" className={styles.card}>
            <h2 id="counts">Today at a glance</h2>
            <dl className={styles.counts}>
              <div>
                <dt>Available units</dt>
                <dd>{c!.available_units}</dd>
              </div>
              <div>
                <dt>Waiting for drop-off</dt>
                <dd>{c!.pending_dropoffs}</dd>
              </div>
              <div>
                <dt>Held for pickup</dt>
                <dd>{c!.active_holds}</dd>
              </div>
              <div>
                <dt>Open requests</dt>
                <dd>{c!.open_requests}</dd>
              </div>
              <div>
                <dt>Completed exchanges</dt>
                <dd>{c!.completed_exchanges}</dd>
              </div>
              <div>
                <dt>Open reports</dt>
                <dd>{c!.open_reports}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="dropoffs" className={styles.card}>
            <h2 id="dropoffs">Confirm drop-offs</h2>
            <p className={styles.hint}>
              Offered items aren&apos;t available until you confirm how many you
              physically received.
            </p>
            {board.dropoffs.length === 0 ? (
              <p>No drop-offs are waiting.</p>
            ) : (
              <ul className={styles.list}>
                {board.dropoffs.map((d) => (
                  <li key={d.lot.lot_id} className={styles.item}>
                    <h3>{d.title}</h3>
                    <p>
                      <span className={styles.badgePending}>
                        Pending drop-off
                      </span>{" "}
                      {d.lot.pledged_quantity} offered
                    </p>
                    {d.food && (
                      <p className={styles.food}>
                        {d.food.package_status === "sealed"
                          ? "Sealed"
                          : "Opened"}
                        ,{" "}
                        {d.food.shelf_stable
                          ? "shelf-stable"
                          : "not shelf-stable"}
                        , {d.food.date_label}. Allergens:{" "}
                        {d.food.allergens === null
                          ? "unknown"
                          : d.food.allergens.join(", ") || "none listed"}
                        . Check the package matches its photo.
                      </p>
                    )}
                    <form
                      className={styles.inline}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const qty = Number(
                          new FormData(e.currentTarget).get("qty"),
                        );
                        void act(
                          `receive:${d.lot.lot_id}`,
                          `Receipt confirmed for ${d.title}.`,
                          (key) => confirmReceipt(d.lot.lot_id, qty, key),
                        );
                      }}
                    >
                      <label>
                        Units received
                        <input
                          name="qty"
                          type="number"
                          min={1}
                          max={d.lot.pledged_quantity}
                          defaultValue={d.lot.pledged_quantity}
                          required
                        />
                      </label>
                      <button disabled={busy}>Confirm receipt</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="pickups" className={styles.card}>
            <h2 id="pickups">Pickups</h2>
            {board.holds.length === 0 ? (
              <p>No items are held for pickup.</p>
            ) : (
              <ul className={styles.list}>
                {board.holds.map((h) => (
                  <li key={h.reservation_id} className={styles.item}>
                    <h3>{h.title}</h3>
                    <p>
                      Pickup code{" "}
                      <strong className={styles.code}>{h.pickup_code}</strong> ·{" "}
                      {h.qty} unit{h.qty === 1 ? "" : "s"} ·{" "}
                      {h.expired ? (
                        <span className={styles.badgeWarn}>Hold expired</span>
                      ) : (
                        <>held until {when(h.expires_at)}</>
                      )}
                    </p>
                    <div className={styles.inline}>
                      <button
                        disabled={busy || h.expired}
                        onClick={() =>
                          void act(
                            `pickup:${h.reservation_id}`,
                            `Pickup confirmed for code ${h.pickup_code}.`,
                            (key) => confirmPickup(h.reservation_id, key),
                          )
                        }
                      >
                        Confirm pickup
                      </button>
                      <button
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() =>
                          void act(
                            `release:${h.reservation_id}`,
                            `Hold ${h.pickup_code} released.`,
                            (key) => cancelReservation(h.reservation_id, key),
                          )
                        }
                      >
                        Release hold
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="inventory" className={styles.card}>
            <h2 id="inventory">Inventory</h2>
            {board.inventory.length === 0 ? (
              <p>Nothing has been received here yet.</p>
            ) : (
              <ul className={styles.list}>
                {board.inventory.map((l) => (
                  <li key={l.lot_id} className={styles.item}>
                    <h3>{l.title}</h3>
                    <p>
                      <span className={styles.badgeOk}>
                        {l.available} available
                      </span>{" "}
                      {l.on_hand} on hand · {l.reserved} held
                      {l.past_date && (
                        <>
                          {" "}
                          <span className={styles.badgeWarn}>
                            Past its date: remove it
                          </span>
                        </>
                      )}
                    </p>
                    <form
                      className={styles.inline}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const onHand = Number(
                          new FormData(form).get("on_hand"),
                        );
                        void act(
                          `correct:${l.lot_id}`,
                          `Stock corrected for ${l.title}.`,
                          (key) =>
                            correctStock(
                              l.lot_id,
                              onHand,
                              reasonFrom(form),
                              key,
                            ),
                        );
                      }}
                    >
                      <label>
                        Units on hand
                        <input
                          name="on_hand"
                          type="number"
                          min={l.reserved}
                          defaultValue={l.on_hand}
                          required
                        />
                      </label>
                      <label>
                        Reason
                        <input
                          name="reason"
                          required
                          minLength={3}
                          maxLength={500}
                        />
                      </label>
                      <button disabled={busy}>Correct stock</button>
                    </form>
                    <form
                      className={styles.inline}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        void act(
                          `remove:${l.lot_id}`,
                          `${l.title} removed from inventory.`,
                          (key) => removeStock(l.lot_id, reasonFrom(form), key),
                        );
                      }}
                    >
                      <label>
                        Removal reason
                        <input
                          name="reason"
                          required
                          minLength={3}
                          maxLength={500}
                          placeholder="Unsafe, damaged, or past its date"
                        />
                      </label>
                      <button className={styles.danger} disabled={busy}>
                        Remove from inventory
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="reports" className={styles.card}>
            <h2 id="reports">Reports</h2>
            {board.reports.length === 0 ? (
              <p>No open reports.</p>
            ) : (
              <ul className={styles.list}>
                {board.reports.map((r) => (
                  <li key={r.report_id} className={styles.item}>
                    <h3>{r.title}</h3>
                    <p>
                      Reported {when(r.reported_at)}: “{r.reason}”
                    </p>
                    <form
                      className={styles.inline}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const choice = (
                          e.nativeEvent as SubmitEvent
                        ).submitter?.getAttribute("value");
                        void act(
                          `report:${r.report_id}`,
                          choice === "remove"
                            ? `Listing removed and report closed.`
                            : `Report dismissed.`,
                          () =>
                            choice === "remove"
                              ? moderateListing(
                                  r.listing_id,
                                  "remove",
                                  reasonFrom(form),
                                  r.report_id,
                                )
                              : resolveReport(r.report_id, reasonFrom(form)),
                        );
                      }}
                    >
                      <label>
                        Decision reason
                        <input
                          name="reason"
                          required
                          minLength={3}
                          maxLength={500}
                        />
                      </label>
                      <button
                        className={styles.danger}
                        disabled={busy}
                        value="remove"
                      >
                        Remove listing
                      </button>
                      <button
                        className={styles.secondary}
                        disabled={busy}
                        value="dismiss"
                      >
                        Dismiss report
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="activity" className={styles.card}>
            <h2 id="activity">Recent activity</h2>
            {board.recent_events.length === 0 &&
            board.moderation.length === 0 ? (
              <p>No activity yet.</p>
            ) : (
              <ul className={styles.activity}>
                {board.moderation.map((m) => (
                  <li key={`${m.action}-${m.listing_id}-${m.at}`}>
                    {when(m.at)} · {m.action.replace("_", " ")} · {m.title}:{" "}
                    {m.reason}
                  </li>
                ))}
                {board.recent_events.map((e, i) => (
                  <li key={`${e.lot_id}-${e.at}-${i}`}>
                    {when(e.at)} · {e.kind} · {e.title}
                    {e.on_hand_delta !== 0 &&
                      ` · on hand ${e.on_hand_delta > 0 ? "+" : ""}${e.on_hand_delta}`}
                    {e.by_staff && e.reason && ` · ${e.reason}`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

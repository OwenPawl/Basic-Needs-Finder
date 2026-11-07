"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Check,
  ImagePlus,
  MapPin,
  Package,
  Plus,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  emptyFilters,
  listingInputSchema,
  listingState,
  type ExchangeCatalog,
  type ExchangeFilters,
  type ExchangeListing,
  type ListingInput,
} from "@/lib/exchange";
import {
  loadExchangeCatalog,
  loadExchangeListing,
  loadExchangeListings,
  saveExchangeListing,
  signListingPhotos,
  uploadListingPhoto,
} from "@/lib/exchange-api";
import "./goods-exchange.css";
const emptyInput: ListingInput = {
  kind: "offer",
  title: "",
  description: "",
  category_id: "clothing",
  location_id: "",
  quantity: 1,
  images: [],
  food: null,
};
function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
function Photo({
  path,
  urls,
  title,
}: {
  path?: string;
  urls: Map<string, string>;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [path, urls]);
  return path && urls.get(path) && !failed ? (
    <img
      src={urls.get(path)}
      alt={title}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="goods-photo-empty">
      <Package size={35} aria-hidden="true" />
      <span>{path ? "Photo unavailable" : "No photo provided"}</span>
    </div>
  );
}
export function GoodsExchange() {
  const params = useSearchParams();
  const [catalog, setCatalog] = useState<ExchangeCatalog | null>(null);
  const [rows, setRows] = useState<ExchangeListing[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<ExchangeFilters>(emptyFilters);
  const [search, setSearch] = useState("");
  const [phase, setPhase] = useState<
    "loading" | "ready" | "signin" | "setup" | "error"
  >("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ExchangeListing | null>(null);
  const [editing, setEditing] = useState<ExchangeListing | null | undefined>(
    undefined,
  );
  const [photos, setPhotos] = useState(new Map<string, string>());
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const requestedDetail = useRef<string | null>(null);
  const initialize = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) {
      setPhase("setup");
      return;
    }
    const { data } = await client.auth.getSession();
    if (!data.session) {
      setPhase("signin");
      setCatalog(null);
      setRows([]);
      return;
    }
    try {
      const next = await loadExchangeCatalog();
      setCatalog(next);
      setPhase("ready");
      setError("");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Could not open the exchange.");
    }
  }, []);
  useEffect(() => {
    void initialize();
    const client = getSupabaseClient();
    if (!client) return;
    let timer: ReturnType<typeof setTimeout>;
    const { data } = client.auth.onAuthStateChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void initialize(), 0);
    });
    const onFocus = () => void initialize();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(timer);
      data.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [initialize]);
  useEffect(() => {
    if (!catalog || phase !== "ready") return;
    let active = true;
    const serial = ++request.current;
    setBusy(true);
    void loadExchangeListings(catalog.campus.id, filters)
      .then(async (result) => {
        if (!active || serial !== request.current) return;
        setRows(result.listings);
        setTotal(result.total);
        setError("");
        try {
          const urls = await signListingPhotos(
            result.listings.flatMap((r) => r.images),
          );
          if (active && serial === request.current) setPhotos(urls);
        } catch {
          if (active)
            setNotice(
              "Some photos could not be loaded. Listing details are still available.",
            );
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load listings.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [catalog, filters, refresh, phase]);
  const openDetail = useCallback(async (row: ExchangeListing) => {
    setSelected(row);
    try {
      const urls = await signListingPhotos(row.images);
      setPhotos((current) => new Map([...current, ...urls]));
    } catch {}
  }, []);
  useEffect(() => {
    const id = params.get("listing");
    if (!catalog || !id || requestedDetail.current === id) return;
    requestedDetail.current = id;
    void loadExchangeListing(id)
      .then(openDetail)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Listing not found."),
      );
  }, [catalog, params, openDetail]);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) dialog.current?.close();
  }, [selected]);
  function change(patch: Partial<ExchangeFilters>) {
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 0 }));
  }
  function reset() {
    setFilters(emptyFilters);
    setSearch("");
  }
  function create(kind: "offer" | "request") {
    setEditing(null);
    setSelected(null);
    setNotice("");
    setDraftKind(kind);
  }
  const [draftKind, setDraftKind] = useState<"offer" | "request">("offer");
  return (
    <>
      <a className="skip-link" href="#goods-main">
        Skip to goods exchange
      </a>
      <header className="exchange-header">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            W<span>+</span>
          </span>
          <span>
            Basic Needs Finder<small>WESTERN · BELLINGHAM</small>
          </span>
        </Link>
        <nav aria-label="Exchange navigation">
          <Link href="/">Food & support</Link>
          <Link href="/exchange/" aria-current="page">
            Give & find goods
          </Link>
          <Link href="/account/">My account</Link>
          <Link href="/inbox/">Messages</Link>
        </nav>
      </header>
      <main id="goods-main" className="exchange-page">
        <div className="exchange-intro">
          <div>
            <p className="eyebrow">SHARED BY STUDENTS. ALWAYS FREE.</p>
            <h1>
              A little less unused.
              <br />
              <span>A little more shared.</span>
            </h1>
            <p>
              Offer a warm jacket, find school supplies, or ask for something
              you need. Give useful things another home at Western.
            </p>
          </div>
          <div className="exchange-actions">
            <button className="button primary" onClick={() => create("offer")}>
              <Plus size={18} />
              Offer an item
            </button>
            <button
              className="button secondary"
              onClick={() => create("request")}
            >
              Request something
            </button>
          </div>
        </div>
        <div className="goods-process">
          <span>
            <ShoppingBag size={19} />
            Post an offer or request
          </span>
          <ArrowRight size={15} />
          <span>
            <Package size={19} />
            Staff confirm drop-off
          </span>
          <ArrowRight size={15} />
          <span>
            <Check size={19} />
            Reserve & pick up
          </span>
        </div>
        <p className="goods-location-note">
          Pickup locations follow WWU’s residential mail desks. Arrange drop-off
          with assigned project staff and wait for confirmation before
          collecting an item.{" "}
          <a
            href="https://housing.wwu.edu/life-on-campus/mail-deliveries"
            target="_blank"
            rel="noreferrer"
          >
            Current mail information ↗
          </a>
        </p>
        {editing !== undefined && (
          <ListingEditor
            key={editing?.id ?? draftKind}
            catalog={catalog}
            initial={editing}
            initialKind={draftKind}
            onClose={() => setEditing(undefined)}
            onSaved={(row) => {
              setEditing(undefined);
              setNotice(
                row.kind === "offer"
                  ? "Your offer is posted. It will become available after staff confirms drop-off."
                  : "Your request is posted.",
              );
              change({ mine: true });
              setRefresh((x) => x + 1);
            }}
          />
        )}
        {notice && (
          <p className="goods-notice" role="status">
            {notice}
            <button aria-label="Dismiss update" onClick={() => setNotice("")}>
              <X size={17} />
            </button>
          </p>
        )}
        {phase === "loading" && (
          <p className="goods-state" role="status">
            Opening the exchange…
          </p>
        )}
        {phase === "setup" && (
          <div className="goods-state">
            <Package size={30} />
            <h2>The exchange is being connected.</h2>
            <p>
              You can explore the posting form now. Publishing and shared
              listings will be available when the backend setup is complete.
            </p>
            <Link href="/" className="button secondary">
              Browse WWU food & support
            </Link>
          </div>
        )}
        {phase === "signin" && (
          <div className="goods-state">
            <ShoppingBag size={30} />
            <h2>Useful things. Your campus community.</h2>
            <p>
              Sign in and verify your WWU email to browse students’ posts and
              publish your own. Food and support resources are always open to
              browse.
            </p>
            <Link href="/account/" className="button primary">
              Sign in to the exchange <ArrowRight size={16} />
            </Link>
          </div>
        )}
        {phase === "error" && (
          <div className="goods-state" role="alert">
            <h2>Finish setting up your account.</h2>
            <p>{error}</p>
            <Link href="/account/" className="button primary">
              Open my account
            </Link>
            <button
              className="button secondary"
              onClick={() => void initialize()}
            >
              Try again
            </button>
          </div>
        )}
        {phase === "ready" && (
          <section aria-labelledby="goods-title">
            <div className="goods-section-heading">
              <h2 id="goods-title">
                {filters.mine ? "Your posts" : "The community exchange"}
              </h2>
              <button
                className="goods-text-button"
                onClick={() => change({ mine: !filters.mine })}
              >
                {filters.mine ? "Browse all posts" : "My offers & requests"}
              </button>
            </div>
            {catalog?.campus.is_demo && (
              <p className="goods-notice">
                Test campus · These exchanges are fictional test records.
              </p>
            )}
            <form
              className="goods-search"
              onSubmit={(e) => {
                e.preventDefault();
                change({ query: search });
              }}
            >
              <label>
                <span className="sr-only">Search goods and requests</span>
                <Search size={19} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Jacket, notebooks, a desk lamp…"
                />
              </label>
              <button className="button primary" type="submit">
                Search
              </button>
            </form>
            <div className="goods-tabs" aria-label="Post type">
              {[
                ["", "All posts"],
                ["offer", "Offers"],
                ["request", "Requests"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={filters.kind === id}
                  onClick={() => change({ kind: id })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="goods-filter-row">
              <label>
                Category
                <select
                  value={filters.category}
                  onChange={(e) => change({ category: e.target.value })}
                >
                  <option value="">All categories</option>
                  {catalog?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Pickup desk
                <select
                  value={filters.location}
                  onChange={(e) => change({ location: e.target.value })}
                >
                  <option value="">All locations</option>
                  {catalog?.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sort
                <select
                  value={filters.sort}
                  onChange={(e) => change({ sort: e.target.value })}
                >
                  <option value="recent">Most recent</option>
                  <option value="available">Most available</option>
                </select>
              </label>
              <label className="goods-checkbox">
                <input
                  type="checkbox"
                  checked={filters.available}
                  onChange={(e) => change({ available: e.target.checked })}
                />
                Ready for pickup only
              </label>
            </div>
            <div className="goods-results-meta">
              <p role="status" aria-live="polite">
                {busy
                  ? "Updating…"
                  : `${total} ${total === 1 ? "post" : "posts"}`}
              </p>
              <button onClick={reset} className="goods-text-button">
                Reset filters
              </button>
            </div>
            {error && (
              <div className="goods-error" role="alert">
                <p>{error}</p>
                <button onClick={() => setRefresh((n) => n + 1)}>
                  Retry loading
                </button>
              </div>
            )}
            <div className="goods-grid" aria-busy={busy}>
              {rows.map((row) => {
                const state = listingState(row);
                return (
                  <article className="goods-card" key={row.id}>
                    <button
                      className="goods-image-button"
                      onClick={() => void openDetail(row)}
                      aria-label={`View ${row.title}`}
                    >
                      <Photo
                        path={row.images[0]}
                        urls={photos}
                        title={row.title}
                      />
                    </button>
                    <div className="goods-card-body">
                      <div className="goods-card-tags">
                        <span className={`goods-kind ${row.kind}`}>
                          {row.kind === "offer" ? "FREE OFFER" : "REQUEST"}
                        </span>
                        <span>{row.category_name}</span>
                      </div>
                      <h3>
                        <button onClick={() => void openDetail(row)}>
                          {row.title}
                        </button>
                      </h3>
                      <p className={`goods-status ${state.tone}`}>
                        <span />
                        {state.label}
                      </p>
                      <p className="goods-card-description">
                        {row.description}
                      </p>
                      <p className="goods-place">
                        <MapPin size={15} />
                        {row.location.name}
                      </p>
                      <div className="goods-card-foot">
                        <time dateTime={row.created_at}>
                          {dateLabel(row.created_at)}
                        </time>
                        <button onClick={() => void openDetail(row)}>
                          View details <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {!busy && !rows.length && !error && (
              <div className="goods-state">
                <Package size={30} />
                <h3>
                  {filters.mine
                    ? "Your first post starts here."
                    : "No posts match yet."}
                </h3>
                <p>
                  {filters.mine
                    ? "Offer something useful or tell the community what you need."
                    : "Try another filter, or be the first to share something in this community."}
                </p>
                <button
                  className="button primary"
                  onClick={() => create("offer")}
                >
                  Offer an item
                </button>
                <button className="button secondary" onClick={reset}>
                  Show all posts
                </button>
              </div>
            )}
            {total > 24 && (
              <div className="goods-pagination">
                <button
                  className="button secondary"
                  disabled={filters.page === 0 || busy}
                  onClick={() => change({ page: filters.page - 1 })}
                >
                  Previous
                </button>
                <span>
                  Page {filters.page + 1} of {Math.ceil(total / 24)}
                </span>
                <button
                  className="button secondary"
                  disabled={(filters.page + 1) * 24 >= total || busy}
                  onClick={() => change({ page: filters.page + 1 })}
                >
                  Next
                </button>
              </div>
            )}
          </section>
        )}
        <div className="goods-help">
          <h2>How sharing works.</h2>
          <div>
            <p>
              <strong>Offers start as a pledge.</strong> A quantity in a post is
              what the student plans to donate. Staff confirms what actually
              arrives.
            </p>
            <p>
              <strong>Requests are a way to ask.</strong> They do not add
              inventory. Other students can respond through the listing’s
              private conversation.
            </p>
            <p>
              <strong>Pickup follows a reservation.</strong> Only received stock
              becomes reservable. Cancelled or expired holds release those
              units.
            </p>
          </div>
        </div>
      </main>
      <footer>
        <span>Independent student project · Not an official WWU service</span>
        <Link href="/">
          Food, benefits & community support <ArrowRight size={15} />
        </Link>
      </footer>
      <dialog
        className="goods-detail"
        ref={dialog}
        aria-labelledby="goods-detail-title"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <button
              autoFocus
              className="goods-close"
              aria-label="Close item details"
              onClick={() => setSelected(null)}
            >
              <X size={22} />
            </button>
            <div className="goods-detail-photo">
              <Photo
                path={selected.images[0]}
                urls={photos}
                title={selected.title}
              />
            </div>
            {selected.images.length > 1 && (
              <div className="goods-gallery">
                {selected.images.slice(1).map((path) => (
                  <Photo
                    key={path}
                    path={path}
                    urls={photos}
                    title={selected.title}
                  />
                ))}
              </div>
            )}
            <div className="goods-detail-content">
              <p className={`goods-kind ${selected.kind}`}>
                {selected.kind === "offer" ? "FREE OFFER" : "COMMUNITY REQUEST"}{" "}
                · {selected.category_name}
              </p>
              <h2 id="goods-detail-title">{selected.title}</h2>
              <p className={`goods-status ${listingState(selected).tone}`}>
                {listingState(selected).label}
              </p>
              <p className="goods-description">{selected.description}</p>
              <dl>
                <dt>
                  Quantity {selected.kind === "offer" ? "offered" : "requested"}
                </dt>
                <dd>{selected.quantity ?? "Not specified"}</dd>
                <dt>Pickup location</dt>
                <dd>
                  {selected.location.name}
                  <br />
                  {selected.location.building}
                </dd>
                <dt>Desk hours</dt>
                <dd>{selected.location.hours}</dd>
                <dt>Collection instructions</dt>
                <dd>{selected.location.instructions}</dd>
              </dl>
              {selected.food && (
                <div className="goods-food">
                  <h3>Package information</h3>
                  <p>{selected.food.food_name} · Sealed · Shelf-stable</p>
                  <p>
                    {selected.food.date_label.replace("_", " ")}:{" "}
                    {selected.food.best_by}
                  </p>
                  <p>Storage: {selected.food.storage}</p>
                  <p>
                    Allergens:{" "}
                    {selected.food.allergens_known
                      ? selected.food.allergens.join(", ") ||
                        "None listed on package"
                      : "Unknown — check the package label"}
                  </p>
                </div>
              )}
              <div className="goods-detail-actions">
                {selected.is_owner &&
                  (selected.kind === "request" ||
                    selected.lots.every((l) => l.status === "pledged")) && (
                    <button
                      className="button primary"
                      onClick={() => {
                        setEditing(selected);
                        setSelected(null);
                      }}
                    >
                      Edit your post
                    </button>
                  )}
                <Link
                  href={
                    selected.is_owner
                      ? "/inbox/"
                      : `/inbox/?listing=${selected.id}`
                  }
                  className="button secondary"
                >
                  Respond privately <ArrowRight size={16} />
                </Link>
                {selected.kind === "offer" &&
                  selected.lots.some(
                    (l) => l.status === "received" && l.available > 0,
                  ) && (
                    <Link
                      href={`/reservations/?listing=${selected.id}`}
                      className="button primary"
                    >
                      Reserve for pickup
                    </Link>
                  )}
              </div>
              <ReportListing listingId={selected.id} />
              <p className="goods-detail-note">
                No public contact details are shown. Share only what is needed
                to arrange your exchange.
              </p>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

function ListingEditor({
  catalog,
  initial,
  initialKind,
  onClose,
  onSaved,
}: {
  catalog: ExchangeCatalog | null;
  initial: ExchangeListing | null;
  initialKind: "offer" | "request";
  onClose: () => void;
  onSaved: (row: ExchangeListing) => void;
}) {
  const [value, setValue] = useState<ListingInput>(() =>
    initial
      ? {
          kind: initial.kind,
          title: initial.title,
          description: initial.description,
          category_id: initial.category_id,
          location_id: initial.location.id,
          quantity: initial.quantity,
          images: initial.images,
          food: initial.food,
        }
      : { ...emptyInput, kind: initialKind },
  );
  const [allergensText, setAllergensText] = useState(
    initial?.food?.allergens.join(", ") ?? "",
  );
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [urls, setUrls] = useState(new Map<string, string>());
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const key = useRef<string | null>(null);
  const fingerprint = useRef("");
  const form = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    form.current?.scrollIntoView({ block: "start" });
    form.current
      ?.querySelector<HTMLInputElement>("[name=title]")
      ?.focus({ preventScroll: true });
    if (initial?.images.length)
      void signListingPhotos(initial.images)
        .then(setUrls)
        .catch(() => {});
  }, [initial]);
  function patch(next: Partial<ListingInput>) {
    setValue((v) => ({ ...v, ...next }));
    setIssues({});
  }
  const isFood = value.kind === "offer" && value.category_id === "food";
  const food = value.food ?? {
    food_name: "",
    date_label: "best_by" as const,
    best_by: "",
    opened: false as const,
    shelf_stable: true as const,
    storage: "",
    allergens: [],
    allergens_known: false,
  };
  function patchFood(next: Partial<NonNullable<ListingInput["food"]>>) {
    patch({ food: { ...food, ...next } });
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    if (value.images.length + files.length > 4) {
      setError("Choose no more than four photos.");
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const path = await uploadListingPhoto(file);
        setValue((v) => ({ ...v, images: [...v.images, path] }));
        const signed = await signListingPhotos([path]);
        setUrls((current) => new Map([...current, ...signed]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const input = {
      ...value,
      food:
        isFood && value.food
          ? {
              ...value.food,
              allergens: value.food.allergens_known
                ? allergensText
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                : [],
            }
          : null,
    };
    const valid = listingInputSchema.safeParse(input);
    if (!valid.success) {
      setIssues(
        Object.fromEntries(
          valid.error.issues.map((i) => [i.path[0] as string, i.message]),
        ),
      );
      setError("Check the highlighted fields before publishing.");
      return;
    }
    if (!catalog) {
      setError(
        "Sign in and verify your WWU email before publishing. Your draft stays here while this page is open.",
      );
      return;
    }
    setSaving(true);
    try {
      const serialized = JSON.stringify(valid.data);
      if (fingerprint.current !== serialized) {
        key.current = crypto.randomUUID();
        fingerprint.current = serialized;
      }
      const row = await saveExchangeListing(
        catalog.campus.id,
        id,
        valid.data,
        key.current!,
        initial?.updated_at ?? null,
      );
      onSaved(row);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Your post was not confirmed. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    if (error)
      form.current?.querySelector<HTMLElement>("[role=alert]")?.focus();
  }, [error]);
  const fieldError = (name: string) =>
    issues[name] ? (
      <span id={`error-${name}`} className="goods-field-error">
        {issues[name]}
      </span>
    ) : null;
  return (
    <form
      ref={form}
      className="goods-editor"
      aria-labelledby="post-title"
      onSubmit={submit}
    >
      <div className="goods-editor-heading">
        <div>
          <p className="eyebrow">
            {initial
              ? "UPDATE YOUR POST"
              : "SOMETHING TO SHARE. SOMETHING YOU NEED."}
          </p>
          <h2 id="post-title">
            {initial
              ? "Edit your post"
              : value.kind === "offer"
                ? "Offer an item"
                : "Make a request"}
          </h2>
        </div>
        <button
          type="button"
          className="goods-close-inline"
          aria-label="Close posting form"
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </div>
      {!catalog && (
        <p className="goods-notice">
          Sign in to upload photos and publish. You can fill in the details
          first.{" "}
          <Link href="/account/" target="_blank" rel="noreferrer">
            Open sign-in in a new tab ↗
          </Link>
        </p>
      )}
      {error && (
        <div className="goods-error" role="alert" tabIndex={-1}>
          {error}
        </div>
      )}
      {!initial && (
        <fieldset className="goods-kind-choice">
          <legend>What would you like to post?</legend>
          <label>
            <input
              type="radio"
              name="kind"
              checked={value.kind === "offer"}
              onChange={() => patch({ kind: "offer" })}
            />
            I have something to offer
          </label>
          <label>
            <input
              type="radio"
              name="kind"
              checked={value.kind === "request"}
              onChange={() => patch({ kind: "request" })}
            />
            I’m looking for something
          </label>
        </fieldset>
      )}
      <div className="goods-form-grid">
        <label className="goods-span">
          Title (required)
          <input
            name="title"
            maxLength={80}
            value={value.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder={
              value.kind === "offer"
                ? "A warm winter jacket, size medium"
                : "Looking for a winter jacket"
            }
            aria-invalid={!!issues.title}
            aria-describedby={issues.title ? "error-title" : undefined}
          />
          {fieldError("title")}
        </label>
        <label className="goods-span">
          Description (required)
          <textarea
            maxLength={2000}
            rows={4}
            value={value.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Describe the item, its condition, sizing, or what would help. Keep contact details private."
            aria-invalid={!!issues.description}
            aria-describedby={
              issues.description ? "error-description" : undefined
            }
          />
          {fieldError("description")}
        </label>
        <label>
          Category (required)
          <select
            value={value.category_id}
            onChange={(e) => patch({ category_id: e.target.value })}
          >
            {(
              catalog?.categories ?? [
                { id: "clothing", name: "Clothing" },
                { id: "shoes", name: "Shoes" },
                { id: "supplies", name: "School Supplies" },
                { id: "household", name: "Household Essentials" },
                { id: "food", name: "Food" },
                { id: "other", name: "Other" },
              ]
            ).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {fieldError("category_id")}
        </label>
        <label>
          Quantity {value.kind === "offer" ? "(required)" : "(optional)"}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            value={value.quantity ?? ""}
            onChange={(e) =>
              patch({
                quantity: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            aria-invalid={!!issues.quantity}
          />
          {fieldError("quantity")}
        </label>
        <label className="goods-span">
          Pickup / drop-off desk (required)
          <select
            value={value.location_id}
            onChange={(e) => patch({ location_id: e.target.value })}
            aria-invalid={!!issues.location_id}
          >
            <option value="">Choose a campus mail pickup desk</option>
            {catalog?.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.building}
              </option>
            ))}
          </select>
          {fieldError("location_id")}
          <small>
            {catalog && !catalog.locations.length
              ? "No pickup desks are enabled yet. The organizer needs to configure a location."
              : "Confirm the exchange with assigned project staff before bringing items."}
          </small>
        </label>
        <fieldset className="goods-span goods-photo-field">
          <legend>
            Item photos{" "}
            {value.kind === "offer" ? "(at least one required)" : "(optional)"}
          </legend>
          <p>
            Use your own photos of the actual item. No AI images. JPG, PNG or
            WebP, up to 5 MB each; maximum four.
          </p>
          <div className="goods-uploaded">
            {value.images.map((path) => (
              <div key={path}>
                <Photo path={path} urls={urls} title="Your item photo" />
                <button
                  type="button"
                  aria-label="Remove this photo from the post"
                  onClick={() =>
                    patch({ images: value.images.filter((p) => p !== path) })
                  }
                >
                  <X size={18} />
                </button>
              </div>
            ))}
          </div>
          <label className="goods-upload-button">
            <ImagePlus size={20} />
            {uploading ? "Uploading…" : "Choose photos"}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={
                !catalog || uploading || saving || value.images.length >= 4
              }
              onChange={(e) => void upload(e.target.files)}
            />
          </label>
          {fieldError("images")}
        </fieldset>
        {isFood && (
          <fieldset className="goods-span goods-food-fields">
            <legend>Food package information</legend>
            <p>
              Only sealed, shelf-stable food can be accepted. Use a photo that
              shows the actual package and date label. Staff checks it again at
              drop-off.
            </p>
            {fieldError("food")}
            <div className="goods-form-grid">
              <label>
                Food name (required)
                <input
                  value={food.food_name}
                  onChange={(e) => patchFood({ food_name: e.target.value })}
                />
              </label>
              <label>
                Date label
                <select
                  value={food.date_label}
                  onChange={(e) =>
                    patchFood({
                      date_label: e.target.value as typeof food.date_label,
                    })
                  }
                >
                  <option value="best_by">Best by</option>
                  <option value="use_by">Use by</option>
                  <option value="expiration">Expiration</option>
                </select>
              </label>
              <label>
                Package date (required)
                <input
                  type="date"
                  value={food.best_by}
                  onChange={(e) => patchFood({ best_by: e.target.value })}
                />
              </label>
              <label>
                Storage instructions (required)
                <input
                  value={food.storage}
                  onChange={(e) => patchFood({ storage: e.target.value })}
                  placeholder="As printed on the package"
                />
              </label>
              <label className="goods-span">
                Allergen information
                <select
                  value={food.allergens_known ? "known" : "unknown"}
                  onChange={(e) =>
                    patchFood({
                      allergens_known: e.target.value === "known",
                      allergens: [],
                    })
                  }
                >
                  <option value="unknown">
                    I don’t know — keep it marked unknown
                  </option>
                  <option value="known">I checked the package label</option>
                </select>
              </label>
              {food.allergens_known && (
                <label className="goods-span">
                  Allergens listed (separate with commas; leave blank if none
                  listed)
                  <input
                    value={allergensText}
                    onChange={(e) => setAllergensText(e.target.value)}
                  />
                </label>
              )}
              <label className="goods-checkbox goods-span">
                <input type="checkbox" required />I confirm the package is
                sealed and shelf-stable.
              </label>
            </div>
          </fieldset>
        )}
      </div>
      <div className="goods-editor-footer">
        <p>
          {value.kind === "offer"
            ? "Publishing a pledge does not make the item available for pickup."
            : "A request tells the community what you need; it creates no inventory."}
        </p>
        <button className="button secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          type="submit"
          disabled={saving || uploading}
          aria-busy={saving}
        >
          {saving
            ? "Publishing…"
            : initial
              ? "Save changes"
              : "Publish " + value.kind}
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}

function ReportListing({ listingId }: { listingId: string }) {
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const r = await getSupabaseClient()!.rpc("report_listing", {
      listing_id: listingId,
      reason,
    });
    setBusy(false);
    setStatus(
      r.error
        ? "The report was not confirmed. Please try again."
        : "Report sent to staff assigned to this location.",
    );
    if (!r.error) setReason("");
  }
  return (
    <details className="goods-report">
      <summary>Report this listing</summary>
      <form onSubmit={submit}>
        <label>
          What should staff review?
          <textarea
            required
            minLength={5}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button className="button secondary" disabled={busy}>
          {busy ? "Sending…" : "Send report"}
        </button>
      </form>
      <p role="status">{status}</p>
    </details>
  );
}

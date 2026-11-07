"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  loadExchangeCatalog,
  signListingPhotos,
  uploadListingPhoto,
} from "@/lib/exchange-api";
import {
  closeFoodPost,
  formatWindow,
  isoToLocal,
  loadFoodPosts,
  localToIso,
  saveFoodPost,
  stateLabel,
  type FoodPost,
  type FoodPostInput,
} from "@/lib/food";
import base from "./account.module.css";
import styles from "./food-posts.module.css";

type View = "loading" | "unavailable" | "signed-out" | "not-verified" | "ready";
type Kind = "" | "meal" | "event";

const blank = (): FoodPostInput => ({
  kind: "meal",
  title: "",
  description: "",
  photos: [],
  servings: 2,
  prepared_at: isoToLocal(null, -30),
  available_from: isoToLocal(null, 0),
  available_until: isoToLocal(null, 180),
  pickup_place: "",
  pickup_instructions: "",
  ingredients: "",
  allergens: [],
  allergens_known: false,
  handling: "",
});

export function FoodPosts() {
  const [view, setView] = useState<View>("loading");
  const [campus, setCampus] = useState("");
  const [kind, setKind] = useState<Kind>("");
  const [mine, setMine] = useState(false);
  const [posts, setPosts] = useState<FoodPost[]>([]);
  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState<FoodPost | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FoodPostInput>(blank);
  const [allergenText, setAllergenText] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestKey = useRef("");
  const formHeading = useRef<HTMLHeadingElement>(null);

  const refresh = useCallback(async (campusId: string, k: Kind, m: boolean) => {
    try {
      const list = await loadFoodPosts(campusId, k, m);
      setPosts(list);
      setPhotos(
        await signListingPhotos(list.map((p) => p.photos[0]).filter(Boolean)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn’t load food posts.");
    }
  }, []);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return setView("unavailable");
    void (async () => {
      const { data } = await client.auth.getSession();
      if (!data.session) return setView("signed-out");
      try {
        const catalog = await loadExchangeCatalog();
        setCampus(catalog.campus.id);
        setView("ready");
      } catch {
        setView("not-verified");
      }
    })();
  }, []);

  useEffect(() => {
    if (view === "ready" && campus) void refresh(campus, kind, mine);
  }, [view, campus, kind, mine, refresh]);

  useEffect(() => {
    if (formOpen) formHeading.current?.focus({ preventScroll: false });
  }, [formOpen]);

  function startNew() {
    setEditing(null);
    setForm(blank());
    setAllergenText("");
    requestKey.current = "";
    setError("");
    setFormOpen(true);
  }

  function startEdit(post: FoodPost) {
    setEditing(post);
    setForm({
      kind: post.kind,
      title: post.title,
      description: post.description,
      photos: post.photos,
      servings: post.servings,
      prepared_at: post.prepared_at ? isoToLocal(post.prepared_at) : null,
      available_from: isoToLocal(post.available_from),
      available_until: isoToLocal(post.available_until),
      pickup_place: post.pickup_place,
      pickup_instructions: post.pickup_instructions,
      ingredients: post.ingredients,
      allergens: post.allergens,
      allergens_known: post.allergens_known,
      handling: post.handling,
    });
    setAllergenText(post.allergens.join(", "));
    requestKey.current = "";
    setError("");
    setFormOpen(true);
  }

  const set = <K extends keyof FoodPostInput>(
    key: K,
    value: FoodPostInput[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, 4 - form.photos.length))
        added.push(await uploadListingPhoto(file));
      set("photos", [...form.photos, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const payload: FoodPostInput = {
      ...form,
      servings: form.kind === "meal" ? form.servings : form.servings || null,
      prepared_at:
        form.kind === "meal" ? localToIso(form.prepared_at ?? "") : null,
      available_from: localToIso(form.available_from) ?? "",
      available_until: localToIso(form.available_until) ?? "",
      allergens: form.allergens_known
        ? allergenText
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
    };
    if (!requestKey.current) requestKey.current = crypto.randomUUID();
    setBusy(true);
    setError("");
    try {
      const id = editing?.id ?? crypto.randomUUID();
      await saveFoodPost(
        campus,
        id,
        payload,
        requestKey.current,
        editing?.updated_at ?? null,
      );
      requestKey.current = "";
      setFormOpen(false);
      setNotice(editing ? "Your post was updated." : "Your food post is live.");
      await refresh(campus, kind, mine);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your post wasn’t saved.");
    } finally {
      setBusy(false);
    }
  }

  async function close(post: FoodPost) {
    setBusy(true);
    setError("");
    try {
      await closeFoodPost(post.id);
      setNotice(`“${post.title}” is closed.`);
      await refresh(campus, kind, mine);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn’t close that post.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={base.page}>
      <div className={base.glow} aria-hidden="true" />
      <a className={`${base.back} ${styles.wide}`} href="../">
        <span aria-hidden="true">←</span> Back to Basic Needs Finder
      </a>
      <section
        className={`${base.card} ${styles.wide}`}
        aria-labelledby="food-title"
      >
        <div className={base.step}>
          <div className={styles.header}>
            <div>
              <p className={styles.eyebrow}>Student to student</p>
              <h1 id="food-title">Homemade food &amp; free-food events</h1>
              <p className={base.lede}>
                Share extra meals you cooked, or post a pop-up with free food.
                Arrange pickup in private messages, never by sharing your phone
                number.
              </p>
            </div>
            {view === "ready" && !formOpen && (
              <button
                className={`${base.primary} ${styles.shareButton}`}
                onClick={startNew}
              >
                Share food
              </button>
            )}
          </div>

          {view === "loading" && (
            <p className={base.loading} role="status">
              <span className={base.spinner} aria-hidden="true" /> Loading food
              posts…
            </p>
          )}
          {view === "unavailable" && (
            <p className={base.lede}>
              Live accounts aren’t connected in this preview, so food posts are
              off.
            </p>
          )}
          {view === "signed-out" && (
            <div className={styles.callout}>
              <p>
                <b>Sign in with your university email</b> to see food near you
                and share your own.
              </p>
              <a className={base.primary} href="../account/">
                Sign in
              </a>
            </div>
          )}
          {view === "not-verified" && (
            <div className={styles.callout}>
              <p>
                Verify your campus on your account page to see and share food
                posts.
              </p>
              <a className={base.primary} href="../account/">
                Go to my account
              </a>
            </div>
          )}

          {view === "ready" && formOpen && (
            <form className={styles.form} onSubmit={submit} noValidate>
              <h2 ref={formHeading} tabIndex={-1}>
                {editing ? "Edit your post" : "Share food"}
              </h2>
              <p className={styles.safety}>
                Share only food you would serve a friend, label allergens
                honestly, and keep it at a safe temperature. These are student
                posts: WWU doesn’t inspect or endorse them.
              </p>
              <fieldset className={styles.kind}>
                <legend>What are you sharing? (required)</legend>
                {(
                  [
                    [
                      "meal",
                      "A meal I made",
                      "Homemade or prepared food with a pickup window",
                    ],
                    [
                      "event",
                      "A free-food event",
                      "A pop-up, club leftovers or a shared meal",
                    ],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label
                    key={value}
                    className={form.kind === value ? styles.kindOn : undefined}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={value}
                      checked={form.kind === value}
                      disabled={Boolean(editing)}
                      onChange={() => set("kind", value)}
                    />
                    <span>
                      <b>{label}</b>
                      <small>{hint}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className={base.field}>
                <span>Title (required)</span>
                <input
                  maxLength={80}
                  required
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                />
              </label>
              <label className={base.field}>
                <span>Description (required)</span>
                <textarea
                  rows={3}
                  maxLength={2000}
                  required
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </label>
              <div className={base.field}>
                <span>Photos of the actual food (1–4, required)</span>
                <div className={styles.photoRow}>
                  {form.photos.map((p) => (
                    <span key={p} className={styles.photoChip}>
                      Photo added
                      <button
                        type="button"
                        onClick={() =>
                          set(
                            "photos",
                            form.photos.filter((x) => x !== p),
                          )
                        }
                        aria-label="Remove this photo"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {form.photos.length < 4 && (
                    <label className={styles.uploadButton}>
                      {uploading ? "Uploading…" : "Choose photos"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        disabled={uploading}
                        onChange={(e) => void upload(e.target.files)}
                      />
                    </label>
                  )}
                </div>
              </div>
              <div className={styles.grid}>
                <label className={base.field}>
                  <span>
                    Servings{form.kind === "meal" ? " (required)" : ""}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    inputMode="numeric"
                    value={form.servings ?? ""}
                    onChange={(e) =>
                      set(
                        "servings",
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  />
                </label>
                {form.kind === "meal" && (
                  <label className={base.field}>
                    <span>When was it prepared? (required)</span>
                    <input
                      type="datetime-local"
                      value={form.prepared_at ?? ""}
                      onChange={(e) => set("prepared_at", e.target.value)}
                    />
                  </label>
                )}
                <label className={base.field}>
                  <span>
                    {form.kind === "meal" ? "Pickup from" : "Event starts"}{" "}
                    (required)
                  </span>
                  <input
                    type="datetime-local"
                    value={form.available_from}
                    onChange={(e) => set("available_from", e.target.value)}
                  />
                </label>
                <label className={base.field}>
                  <span>
                    {form.kind === "meal" ? "Pickup until" : "Event ends"}{" "}
                    (required)
                  </span>
                  <input
                    type="datetime-local"
                    value={form.available_until}
                    onChange={(e) => set("available_until", e.target.value)}
                  />
                </label>
              </div>
              <label className={base.field}>
                <span>Pickup place (required)</span>
                <input
                  maxLength={160}
                  placeholder="e.g. Buchanan Towers lobby"
                  value={form.pickup_place}
                  onChange={(e) => set("pickup_place", e.target.value)}
                />
              </label>
              <label className={base.field}>
                <span>Pickup instructions</span>
                <textarea
                  rows={2}
                  maxLength={600}
                  value={form.pickup_instructions}
                  onChange={(e) => set("pickup_instructions", e.target.value)}
                />
              </label>
              <label className={base.field}>
                <span>Ingredients</span>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={form.ingredients}
                  onChange={(e) => set("ingredients", e.target.value)}
                />
              </label>
              <fieldset className={styles.kind}>
                <legend>Allergens (required)</legend>
                <label
                  className={form.allergens_known ? styles.kindOn : undefined}
                >
                  <input
                    type="radio"
                    name="allergens"
                    checked={form.allergens_known}
                    onChange={() => set("allergens_known", true)}
                  />
                  <span>
                    <b>I know the allergens</b>
                  </span>
                </label>
                <label
                  className={!form.allergens_known ? styles.kindOn : undefined}
                >
                  <input
                    type="radio"
                    name="allergens"
                    checked={!form.allergens_known}
                    onChange={() => set("allergens_known", false)}
                  />
                  <span>
                    <b>I’m not sure</b>
                    <small>Shown as “Allergens unknown”</small>
                  </span>
                </label>
              </fieldset>
              {form.allergens_known && (
                <label className={base.field}>
                  <span>
                    Allergens, separated by commas (leave empty for none)
                  </span>
                  <input
                    value={allergenText}
                    onChange={(e) => setAllergenText(e.target.value)}
                    placeholder="e.g. peanuts, milk, wheat"
                  />
                </label>
              )}
              <label className={base.field}>
                <span>Storage and handling</span>
                <input
                  maxLength={500}
                  placeholder="e.g. Keep refrigerated; reheat until hot."
                  value={form.handling}
                  onChange={(e) => set("handling", e.target.value)}
                />
              </label>
              <div className={styles.formActions}>
                <button
                  className={base.primary}
                  disabled={busy || uploading}
                  aria-busy={busy}
                >
                  {busy ? "Saving…" : editing ? "Save changes" : "Post food"}
                </button>
                <button
                  type="button"
                  className={base.secondary}
                  onClick={() => setFormOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {view === "ready" && !formOpen && (
            <>
              <div
                className={styles.filters}
                role="group"
                aria-label="Filter food posts"
              >
                {(
                  [
                    ["", "Everything"],
                    ["meal", "Meals"],
                    ["event", "Events"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                  >
                    {label}
                  </button>
                ))}
                <button aria-pressed={mine} onClick={() => setMine((m) => !m)}>
                  My posts
                </button>
              </div>
              <p className={styles.count} role="status" aria-live="polite">
                {posts.length} {posts.length === 1 ? "post" : "posts"}
              </p>
              {posts.length === 0 ? (
                <div className={base.empty}>
                  <p>
                    <b>
                      {mine
                        ? "You haven’t posted any food yet."
                        : "No food is being shared right now."}
                    </b>
                  </p>
                  <p>Cooked too much? Choose “Share food” to post it.</p>
                </div>
              ) : (
                <ul className={styles.cards}>
                  {posts.map((p) => (
                    <li key={p.id} className={styles.card}>
                      {photos.get(p.photos[0]) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photos.get(p.photos[0])}
                          alt={`Photo of ${p.title}`}
                          className={styles.photo}
                        />
                      ) : (
                        <div className={styles.photo} aria-hidden="true" />
                      )}
                      <div className={styles.cardBody}>
                        <div className={styles.badges}>
                          <span className={styles.kindBadge}>
                            {p.kind === "meal"
                              ? "Homemade meal"
                              : "Free-food event"}
                          </span>
                          <span
                            className={`${styles.state} ${styles[p.state]}`}
                          >
                            {stateLabel[p.state]}
                          </span>
                        </div>
                        <h2>{p.title}</h2>
                        <p className={styles.meta}>
                          {formatWindow(p.available_from, p.available_until)} ·{" "}
                          {p.pickup_place}
                        </p>
                        <p>{p.description}</p>
                        <dl className={styles.facts}>
                          {p.servings && (
                            <div>
                              <dt>Servings</dt>
                              <dd>{p.servings}</dd>
                            </div>
                          )}
                          {p.prepared_at && (
                            <div>
                              <dt>Prepared</dt>
                              <dd>
                                {new Date(p.prepared_at).toLocaleString(
                                  undefined,
                                  {
                                    weekday: "short",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  },
                                )}
                              </dd>
                            </div>
                          )}
                          <div>
                            <dt>Allergens</dt>
                            <dd>
                              {p.allergens_known
                                ? p.allergens.join(", ") || "None listed"
                                : "Unknown — ask before eating"}
                            </dd>
                          </div>
                          {p.ingredients && (
                            <div>
                              <dt>Ingredients</dt>
                              <dd>{p.ingredients}</dd>
                            </div>
                          )}
                          {p.handling && (
                            <div>
                              <dt>Handling</dt>
                              <dd>{p.handling}</dd>
                            </div>
                          )}
                          {p.pickup_instructions && (
                            <div>
                              <dt>Pickup</dt>
                              <dd>{p.pickup_instructions}</dd>
                            </div>
                          )}
                        </dl>
                        <p className={styles.by}>Shared by {p.author_name}</p>
                        <div className={styles.cardActions}>
                          {p.is_owner ? (
                            p.status === "open" && (
                              <>
                                <button
                                  className={base.secondary}
                                  onClick={() => startEdit(p)}
                                >
                                  Edit
                                </button>
                                <button
                                  className={base.secondary}
                                  disabled={busy}
                                  onClick={() => void close(p)}
                                >
                                  Mark as gone
                                </button>
                              </>
                            )
                          ) : p.state === "available" ||
                            p.state === "upcoming" ? (
                            <a
                              className={base.primary}
                              href={`../inbox/?food=${p.id}`}
                            >
                              Message {p.author_name}
                            </a>
                          ) : (
                            <p className={styles.unavailable}>
                              No longer available
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <p className={base.status} role="status" aria-live="polite">
            {notice}
          </p>
          {error && (
            <p className={base.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

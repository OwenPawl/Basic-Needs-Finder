"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Heart,
  Leaf,
  MapPin,
  Package,
  Search,
  Shirt,
  Sprout,
  X,
} from "lucide-react";
import {
  assetPath,
  filterResources,
  type Catalog,
  type CatalogFilters,
  type Resource,
} from "@/lib/catalog";

const defaults: CatalogFilters = {
  query: "",
  category: "",
  location: "",
  kind: "ALL",
  availableOnly: false,
  sort: "recent",
};
const stateLabel = {
  AVAILABLE: "Ready for pickup",
  PENDING: "Awaiting drop-off",
  RESERVED: "Currently reserved",
  REQUEST: "Community request",
};
const categoryIcons: Record<string, typeof Leaf> = {
  food: Leaf,
  clothing: Shirt,
  supplies: BookOpen,
  household: Package,
};

export function CampusBrowser({ catalog }: { catalog: Catalog }) {
  const [filters, setFilters] = useState<CatalogFilters>(defaults);
  const [selected, setSelected] = useState<Resource | null>(null);
  const [view, setView] = useState<"resources" | "locations">("resources");
  const dialog = useRef<HTMLDialogElement>(null);
  const results = filterResources(catalog.resources, filters);
  const update = <K extends keyof CatalogFilters>(
    key: K,
    value: CatalogFilters[K],
  ) => setFilters((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) dialog.current?.close();
  }, [selected]);
  const location = catalog.locations.find(
    (item) => item.id === selected?.locationId,
  );
  const activeFilters =
    filters.query ||
    filters.category ||
    filters.location ||
    filters.kind !== "ALL" ||
    filters.availableOnly;

  return (
    <>
      <a className="skip-link" href="#resources">
        Skip to resources
      </a>
      <div className="demo-banner">
        <span className="demo-dot" />
        Demo campus <span className="banner-divider">/</span> Fictional
        resources · No real reservations{" "}
        <a href="#about-demo">
          About the demo <ArrowUpRight size={13} />
        </a>
      </div>
      <header className="site-header">
        <a className="brand" href="#">
          <span className="brand-symbol">
            <Sprout size={26} strokeWidth={1.8} />
          </span>
          <span>
            basic needs<span className="brand-small">FINDER</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a
            className={view === "resources" ? "nav-active" : ""}
            href="#resources"
            onClick={() => setView("resources")}
          >
            Find resources
          </a>
          <a
            className={view === "locations" ? "nav-active" : ""}
            href="#resources"
            onClick={() => setView("locations")}
          >
            Pickup locations
          </a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <span className="campus-indicator">
          <MapPin size={16} /> Demo Campus
        </span>
      </header>
      <main>
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <p className="eyebrow">
              <span />
              GOOD THINGS GO FURTHER TOGETHER
            </p>
            <h1 id="hero-heading">
              A little help.
              <br />
              <span>A lot of possibility.</span>
            </h1>
            <p className="hero-description">
              From a warm jacket to your next meal, find everyday essentials
              shared by your campus community. Take what you need. Share what
              you can.
            </p>
            <a
              className="button primary"
              href="#resources"
              onClick={() => setView("resources")}
            >
              Explore resources <ArrowRight size={18} />
            </a>
            <div className="hero-note">
              <Heart size={15} />
              Always free. Always a community effort.
            </div>
          </div>
          <div className="hero-art">
            <div className="art-circle" />
            <img
              src={assetPath("/illustrations/community.svg")}
              width="460"
              height="370"
              alt="Illustration of a tote bag filled with pantry goods, a notebook, and a leafy sprig"
            />
            <div className="art-note">
              <span>little things,</span>
              <strong>big difference.</strong>
              <svg viewBox="0 0 92 23" aria-hidden="true">
                <path d="M2 14Q45 2 90 15M17 21Q50 12 75 19" />
              </svg>
            </div>
            <div className="art-sticker">
              <Check size={16} />
              <div>
                Good for you.
                <br />
                <strong>Good for all of us.</strong>
              </div>
            </div>
          </div>
        </section>
        <section className="community-strip" aria-label="Our approach">
          <span>
            <Leaf size={21} />
            Less waste, more possibility
          </span>
          <span>
            <MapPin size={21} />
            Campus pickup points
          </span>
          <span>
            <Heart size={21} />A little kindness goes a long way
          </span>
        </section>
        <section
          id="resources"
          className="resource-section"
          aria-labelledby="resources-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR CAMPUS, CONNECTED</p>
              <h2 id="resources-heading">
                {view === "resources"
                  ? "Find your everyday essentials."
                  : "A familiar place to pick up."}
              </h2>
            </div>
            <p>
              {view === "resources"
                ? "Good things looking for a new home."
                : "Fictional locations for the campus demo."}
            </p>
          </div>
          <div className="view-tabs" aria-label="Browse view">
            <button
              aria-pressed={view === "resources"}
              onClick={() => setView("resources")}
            >
              Resources
            </button>
            <button
              aria-pressed={view === "locations"}
              onClick={() => setView("locations")}
            >
              Pickup locations <span>{catalog.locations.length}</span>
            </button>
          </div>
          {view === "locations" ? (
            <div className="location-grid">
              {catalog.locations.map((item, index) => (
                <article className="location-card" key={item.id}>
                  <div className="location-number">
                    0{index + 1}
                    <MapPin size={27} />
                  </div>
                  <h3>{item.name}</h3>
                  <p>{item.building}</p>
                  <strong>{item.hours}</strong>
                  <p className="location-instructions">{item.instructions}</p>
                  <button
                    className="text-button"
                    onClick={() => {
                      setFilters({
                        ...defaults,
                        location: item.id,
                        availableOnly: true,
                      });
                      setView("resources");
                    }}
                  >
                    Browse available samples <ArrowRight size={16} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <>
              <div className="filter-panel">
                <div className="search-field">
                  <Search size={20} />
                  <input
                    type="search"
                    aria-label="Search resources"
                    placeholder="What would make your day a little easier?"
                    value={filters.query}
                    onChange={(event) => update("query", event.target.value)}
                  />
                </div>
                <label className="select-field">
                  <MapPin size={16} />
                  <span className="sr-only">Pickup location</span>
                  <select
                    value={filters.location}
                    onChange={(event) => update("location", event.target.value)}
                  >
                    <option value="">All pickup locations</option>
                    {catalog.locations.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={15} />
                </label>
              </div>
              <div className="category-row" aria-label="Filter by category">
                <button
                  className={!filters.category ? "selected" : ""}
                  aria-pressed={!filters.category}
                  onClick={() => update("category", "")}
                >
                  All resources
                </button>
                {catalog.categories.map((category) => {
                  const Icon = categoryIcons[category.id] ?? Package;
                  return (
                    <button
                      key={category.id}
                      className={
                        filters.category === category.id ? "selected" : ""
                      }
                      aria-pressed={filters.category === category.id}
                      onClick={() => update("category", category.id)}
                    >
                      <Icon size={15} />
                      {category.name}
                    </button>
                  );
                })}
              </div>
              <div className="results-toolbar">
                <div className="kind-tabs" aria-label="Filter by post type">
                  {(
                    [
                      ["ALL", "Everything"],
                      ["OFFER", "Offers"],
                      ["REQUEST", "Requests"],
                    ] as const
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      aria-pressed={filters.kind === kind}
                      onClick={() =>
                        setFilters((current) => ({
                          ...current,
                          kind,
                          availableOnly:
                            kind === "REQUEST" ? false : current.availableOnly,
                        }))
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="available-filter">
                  <input
                    type="checkbox"
                    checked={filters.availableOnly}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        availableOnly: event.target.checked,
                        kind: event.target.checked ? "OFFER" : current.kind,
                      }))
                    }
                  />
                  Ready for pickup only
                </label>
                <label className="sort-field">
                  Sort by{" "}
                  <select
                    value={filters.sort}
                    onChange={(event) =>
                      update(
                        "sort",
                        event.target.value as CatalogFilters["sort"],
                      )
                    }
                  >
                    <option value="recent">Recently posted</option>
                    <option value="title">Title A–Z</option>
                  </select>
                </label>
              </div>
              <div className="result-count">
                <p role="status" aria-live="polite">
                  {results.length}{" "}
                  {results.length === 1
                    ? "sample resource"
                    : "sample resources"}
                  {activeFilters ? " match your filters" : " in your community"}
                </p>
                {activeFilters && (
                  <button onClick={() => setFilters(defaults)}>
                    Clear filters <X size={13} />
                  </button>
                )}
              </div>
              {results.length ? (
                <div className="resource-grid">
                  {results.map((item) => (
                    <article className="resource-card" key={item.id}>
                      <button
                        className={`resource-visual visual-${item.categoryId}`}
                        aria-label={`View ${item.title}`}
                        onClick={() => setSelected(item)}
                      >
                        <span
                          className={`kind-label ${item.kind.toLowerCase()}`}
                        >
                          {item.kind === "OFFER" ? "OFFER" : "REQUEST"}
                        </span>
                        <img
                          src={assetPath(item.image)}
                          alt={item.imageDescription}
                          width="340"
                          height="240"
                          loading="lazy"
                        />
                        <span className="free-label">
                          {item.kind === "OFFER" ? "Free" : "A little help?"}
                        </span>
                      </button>
                      <div className="card-content">
                        <p className="card-category">
                          {
                            catalog.categories.find(
                              (category) => category.id === item.categoryId,
                            )?.name
                          }
                        </p>
                        <h3>
                          <button onClick={() => setSelected(item)}>
                            {item.title}
                          </button>
                        </h3>
                        <p className="card-location">
                          <MapPin size={13} />
                          {
                            catalog.locations.find(
                              (place) => place.id === item.locationId,
                            )?.name
                          }
                        </p>
                        <div className="card-bottom">
                          <span
                            className={`availability state-${item.status.toLowerCase()}`}
                          >
                            <span />
                            {stateLabel[item.status]}
                          </span>
                          {item.available > 0 && (
                            <span className="quantity">
                              {item.available} available
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <Search size={32} />
                  <h3>No matches just yet.</h3>
                  <p>
                    Try another search or pickup location. A small change can
                    open up a few possibilities.
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => setFilters(defaults)}
                  >
                    Show all resources
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        <section id="how-it-works" className="how-section">
          <div>
            <p className="eyebrow">SMALL STEPS. SHARED SUPPORT.</p>
            <h2>
              A campus that
              <br />
              looks out for you.
            </h2>
            <p>
              The exchange we’re building is simple, free, and designed around
              real campus pickup points.
            </p>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Find something you need</h3>
                <p>
                  Browse offers, share a request, or see what’s at your nearest
                  pickup location.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Wait for a confirmed arrival</h3>
                <p>
                  An offered item becomes available only after campus staff
                  confirms it has arrived.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Reserve, collect, carry on</h3>
                <p>
                  The planned live exchange will hold your item and share
                  collection instructions.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section id="about-demo" className="demo-explainer">
          <Sprout size={25} />
          <div>
            <h2>A first look at something good.</h2>
            <p>
              This is an interactive preview with fictional listings and
              locations. Search, filter, and explore item details. Accounts,
              messages, and real reservations are not available in this version.
            </p>
          </div>
          <a
            href="https://github.com/OwenPawl/Basic-Needs-Finder"
            target="_blank"
            rel="noreferrer"
          >
            Follow the project <ArrowUpRight size={17} />
          </a>
        </section>
      </main>
      <footer>
        <a className="brand" href="#">
          <Sprout size={23} />
          <span>
            basic needs<span className="brand-small">FINDER</span>
          </span>
        </a>
        <p>More community. Fewer barriers.</p>
        <span>A campus resource-sharing project.</span>
      </footer>
      <dialog
        ref={dialog}
        className="resource-dialog"
        onClose={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}
        aria-labelledby="detail-heading"
      >
        {selected && (
          <>
            <button
              className="dialog-close"
              aria-label="Close resource details"
              autoFocus
              onClick={() => setSelected(null)}
            >
              <X size={20} />
            </button>
            <div className={`dialog-visual visual-${selected.categoryId}`}>
              <img
                src={assetPath(selected.image)}
                alt={selected.imageDescription}
                width="340"
                height="240"
              />
            </div>
            <div className="dialog-copy">
              <p className="eyebrow">
                {selected.kind === "OFFER"
                  ? "A COMMUNITY OFFER"
                  : "A COMMUNITY REQUEST"}
              </p>
              <h2 id="detail-heading">{selected.title}</h2>
              <p>{selected.description}</p>
              <div className="detail-status">
                <span
                  className={`availability state-${selected.status.toLowerCase()}`}
                >
                  <span />
                  {stateLabel[selected.status]}
                </span>
                {selected.available > 0 && (
                  <strong>{selected.available} available units</strong>
                )}
              </div>
              <h3>
                <MapPin size={17} />
                {location?.name}
              </h3>
              <p>
                {location?.building}
                <br />
                {location?.hours}
              </p>
              <p>{location?.instructions}</p>
              {selected.food && (
                <details>
                  <summary>Food information</summary>
                  <dl>
                    <dt>Package</dt>
                    <dd>
                      {selected.food.opened ? "Opened" : "Sealed"} ·{" "}
                      {selected.food.shelfStable
                        ? "Shelf-stable"
                        : "Special storage"}
                    </dd>
                    <dt>{selected.food.dateLabel}</dt>
                    <dd>{selected.food.bestBy}</dd>
                    <dt>Allergens</dt>
                    <dd>
                      {selected.food.allergensKnown
                        ? selected.food.allergens.join(", ") ||
                          "No allergens reported"
                        : "Unknown — check the package label"}
                    </dd>
                    <dt>Storage</dt>
                    <dd>{selected.food.storage}</dd>
                  </dl>
                </details>
              )}
              <div className="demo-detail">
                <Leaf size={17} />
                <p>
                  Sample listing only. This demo does not create reservations or
                  send messages.
                </p>
              </div>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

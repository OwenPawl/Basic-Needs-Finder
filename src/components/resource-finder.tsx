"use client";
import Link from "next/link";
import "./goods-exchange.css";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Bus,
  Check,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  HeartHandshake,
  MapPin,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  ShoppingBasket,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  areaNames,
  categories,
  dayNames,
  filterDirectory,
  resourcePlanText,
  type CampusResource,
  type ResourceFilters,
} from "@/lib/resources";
const defaults: ResourceFilters = {
  query: "",
  category: "",
  area: "",
  day: "",
};
const checkedLabel = "November 7, 2026";
function External({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight size={16} aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
export function ResourceFinder({ resources }: { resources: CampusResource[] }) {
  const [filters, setFilters] = useState<ResourceFilters>(defaults);
  const [selected, setSelected] = useState<CampusResource | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [planOnly, setPlanOnly] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = filterDirectory(resources, filters).filter(
    (r) => !planOnly || saved.includes(r.id),
  );
  const planned = resources.filter((r) => saved.includes(r.id));
  const filtered = Boolean(
    filters.query ||
      filters.category ||
      filters.area ||
      filters.day ||
      planOnly,
  );
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) dialog.current?.close();
  }, [selected]);
  function toggle(id: string) {
    setSaved((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }
  function clear() {
    setFilters(defaults);
    setPlanOnly(false);
  }
  function saveText() {
    const url = URL.createObjectURL(
      new Blob([resourcePlanText(planned)], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "wwu-resource-plan.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <a href="#finder" className="skip-link">
        Skip to resource finder
      </a>
      <div className="utility-bar">
        <span>FOR WESTERN WASHINGTON UNIVERSITY STUDENTS</span>
        <External href="https://basicneeds.wwu.edu/">
          WWU Basic Needs Hub
        </External>
      </div>
      <header className="site-header">
        <a href="#" className="brand">
          <span className="brand-mark" aria-hidden="true">
            W<span>+</span>
          </span>
          <span>
            Basic Needs Finder<small>WESTERN · BELLINGHAM</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#finder">Find support</a>
          <Link href="/exchange/">Give &amp; find goods</Link>
          <a href="#about">About</a>
        </nav>
        <a href="#my-plan" className="plan-link">
          <Bookmark size={17} aria-hidden="true" />
          My plan <span>{saved.length}</span>
        </a>
      </header>
      <main>
        <section className="exchange-banner">
          <div>
            <h2>Have something to give? Need something?</h2>
            <p>
              Share clothing, school supplies, household essentials and food
              with other Western students. Offers and requests belong here, too.
            </p>
          </div>
          <Link href="/exchange/" className="button primary">
            Open the goods exchange <ArrowRight size={17} />
          </Link>
        </section>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span />A LITTLE SUPPORT, CLOSE TO CAMPUS
            </p>
            <h1 id="hero-title">
              Your next meal.
              <br />
              <span>One less worry.</span>
            </h1>
            <p className="hero-description">
              Find food, groceries, and a little extra support at Western and
              around Bellingham. Real places. Clear next steps. No sign-in to
              look around.
            </p>
            <a
              className="button primary"
              href="#finder"
              onClick={() => {
                clear();
                search.current?.focus({ preventScroll: true });
              }}
            >
              Find food & support <ArrowRight size={19} />
            </a>
            <p className="hero-note">
              <ShieldCheck size={17} aria-hidden="true" />
              No account. No location tracking.
            </p>
          </div>
          <aside className="start-card" aria-labelledby="start-title">
            <div className="start-card-top">
              <span className="label">A PLACE TO START</span>
              <MapPin size={23} aria-hidden="true" />
            </div>
            <h2 id="start-title">
              The WHOLE
              <br />
              Pantry
            </h2>
            <p>Right here at Western.</p>
            <div className="start-facts">
              <span>
                <MapPin size={17} aria-hidden="true" />
                Viking Union · Room 435
              </span>
              <span>
                <Clock3 size={17} aria-hidden="true" />
                Mon–Sat · 10 am–4 pm
              </span>
              <span>
                <ShoppingBasket size={17} aria-hidden="true" />
                Food & hygiene essentials
              </span>
            </div>
            <button
              className="text-link"
              onClick={() =>
                setSelected(resources.find((r) => r.id === "whole")!)
              }
            >
              See pantry details <ArrowRight size={18} />
            </button>
            <small>
              Closed Sundays, holidays, and VU closures.
              <br />
              <a
                href="https://basicneeds.wwu.edu/whole-pantry"
                target="_blank"
                rel="noreferrer"
              >
                Hours from WWU · checked Nov 7, 2026
              </a>
            </small>
          </aside>
        </section>
        <div className="trust-strip">
          <span>
            <MapPin size={18} />
            WWU + Bellingham
          </span>
          <span>
            <ExternalLink size={18} />
            Direct links to providers
          </span>
          <span>
            <HeartHandshake size={18} />
            Support without the guesswork
          </span>
        </div>
        <section
          id="finder"
          className="finder-section"
          aria-labelledby="finder-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">FIND WHAT WORKS FOR YOU</p>
              <h2 id="finder-title">Good places to turn.</h2>
            </div>
            <p>Start on campus. Explore your community.</p>
          </div>
          <div className="search-row">
            <label className="search-box">
              <Search size={21} aria-hidden="true" />
              <span className="sr-only">Search resources</span>
              <input
                ref={search}
                type="search"
                placeholder="Try “pantry”, “SNAP”, or a building…"
                value={filters.query}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, query: e.target.value }))
                }
              />
            </label>
            <label className="filter-select">
              <MapPin size={17} aria-hidden="true" />
              <span className="sr-only">Resource area</span>
              <select
                value={filters.area}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, area: e.target.value }))
                }
              >
                <option value="">All locations</option>
                <option value="campus">On campus</option>
                <option value="community">Bellingham</option>
                <option value="online">Online / countywide</option>
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
          </div>
          <div className="category-row" aria-label="Resource type">
            {categories.map((c) => (
              <button
                key={c.id}
                aria-pressed={filters.category === c.id}
                onClick={() => setFilters((f) => ({ ...f, category: c.id }))}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="filter-meta">
            <p role="status" aria-live="polite">
              <strong>{results.length}</strong>{" "}
              {results.length === 1 ? "resource" : "resources"}
              {planOnly ? " in your plan" : ""}
            </p>
            <label className="day-filter">
              <SlidersHorizontal size={15} aria-hidden="true" />
              Listed service day
              <select
                value={filters.day}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, day: e.target.value }))
                }
              >
                <option value="">Any day</option>
                {dayNames.map((day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            {filtered && (
              <button className="clear-button" onClick={clear}>
                Clear filters <X size={14} />
              </button>
            )}
          </div>
          <p className="availability-note">
            Hours are provider-listed schedules, not live food availability.
            Holidays and quarter breaks may change access.
          </p>
          {results.length ? (
            <div className="resource-grid">
              {results.map((r) => (
                <article className="resource-card" key={r.id}>
                  <div className="card-top">
                    <span className={`area-badge area-${r.area}`}>
                      <MapPin size={13} />
                      {areaNames[r.area]}
                    </span>
                    <button
                      className="save-button"
                      aria-label={`${saved.includes(r.id) ? "Remove" : "Add"} ${r.title} ${saved.includes(r.id) ? "from" : "to"} my plan`}
                      aria-pressed={saved.includes(r.id)}
                      onClick={() => toggle(r.id)}
                    >
                      {saved.includes(r.id) ? (
                        <Check size={20} />
                      ) : (
                        <Plus size={20} />
                      )}
                    </button>
                  </div>
                  <p className="provider">{r.provider}</p>
                  <h3>
                    <button onClick={() => setSelected(r)}>{r.title}</button>
                  </h3>
                  <p className="resource-summary">{r.summary}</p>
                  <div className="card-facts">
                    <p>
                      <MapPin size={16} />
                      <span>{r.place}</span>
                    </p>
                    <p>
                      <Clock3 size={16} />
                      <span>{r.hours}</span>
                    </p>
                  </div>
                  <div className="card-bottom">
                    <span>
                      {categories.find((c) => c.id === r.category)?.label}
                    </span>
                    <button
                      aria-label={`Details for ${r.title}`}
                      onClick={() => setSelected(r)}
                    >
                      Details <ArrowRight size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Search size={30} />
              <h3>No matches for those filters.</h3>
              <p>
                Try another area, resource type, or service day. Resources
                without a weekly schedule appear under “Any day.”
              </p>
              <button className="button secondary" onClick={clear}>
                Show all resources
              </button>
            </div>
          )}
          <p className="directory-footer">
            Sources checked {checkedLabel}.{" "}
            <a
              href="https://github.com/OwenPawl/Basic-Needs-Finder/issues/new?title=Resource%20information%20correction"
              target="_blank"
              rel="noreferrer"
            >
              Suggest a correction <ArrowUpRight size={14} />
            </a>
          </p>
        </section>
        <section
          className="plan-section"
          id="my-plan"
          aria-labelledby="plan-title"
        >
          <div>
            <p className="eyebrow">TAKE THE NEXT STEP WITH YOU</p>
            <h2 id="plan-title">Your resource plan.</h2>
            <p>
              Add a few options with the + button, then print or save their
              hours, addresses, and links. Your selection stays only in this
              open page.
            </p>
          </div>
          <div className="plan-content">
            {planned.length ? (
              <>
                <ul>
                  {planned.map((r) => (
                    <li key={r.id}>
                      <button
                        className="plan-resource"
                        onClick={() => setSelected(r)}
                      >
                        {r.title}
                        <span>{r.place}</span>
                      </button>
                      <button
                        className="save-button"
                        aria-label={`Remove ${r.title} from plan`}
                        onClick={() => toggle(r.id)}
                      >
                        <X size={17} />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="plan-actions">
                  <button
                    className="button primary"
                    onClick={() => window.print()}
                  >
                    <Printer size={17} />
                    Print plan
                  </button>
                  <button className="button secondary" onClick={saveText}>
                    <Download size={17} />
                    Save text
                  </button>
                  <button
                    className="text-link"
                    onClick={() => {
                      setFilters(defaults);
                      setPlanOnly(true);
                      document.getElementById("finder")?.scrollIntoView();
                    }}
                  >
                    View selected
                  </button>
                </div>
              </>
            ) : (
              <div className="plan-empty">
                <Bookmark size={27} />
                <h3>A small plan can help.</h3>
                <p>
                  No resources selected yet. Add any place or program you want
                  to come back to.
                </p>
              </div>
            )}
          </div>
        </section>
        <section id="getting-there" className="getting-section">
          <div>
            <p className="eyebrow">A WAY THERE, TOO</p>
            <h2>Getting around.</h2>
            <p>You choose where to start. We don’t ask for your location.</p>
          </div>
          <External className="travel-card" href="https://map.wwu.edu/">
            <span className="travel-icon">
              <MapPin size={25} />
            </span>
            <span>
              <strong>WWU campus map</strong>
              <small>Buildings, entrances, and accessibility routes</small>
            </span>
          </External>
          <External
            className="travel-card"
            href="https://schedules.ridewta.com/"
          >
            <span className="travel-icon">
              <Bus size={25} />
            </span>
            <span>
              <strong>Plan a WTA bus trip</strong>
              <small>Current routes, stops, and departure times</small>
            </span>
          </External>
        </section>
        <section id="about" className="about-section">
          <div>
            <p className="eyebrow">BUILT AROUND WESTERN</p>
            <h2>
              Less searching.
              <br />
              More support.
            </h2>
          </div>
          <div>
            <p>
              Basic Needs Finder brings together public information from WWU and
              local providers. It complements the university’s Basic Needs Hub
              and starts with food access.
            </p>
            <p>
              This is an independent student project, not an official WWU
              service. We don’t track visitors, collect student information, or
              show made-up stock counts. Providers manage their own applications
              and availability.
            </p>
            <div className="about-links">
              <External href="https://basicneeds.wwu.edu/">
                Official WWU support
              </External>
              <External href="https://basicneeds.wwu.edu/events">
                WWU resource events
              </External>
            </div>
          </div>
        </section>
      </main>
      <footer>
        <a className="brand" href="#">
          Basic Needs Finder
          <span className="footer-location">WWU · Bellingham, WA</span>
        </a>
        <span>Support belongs within reach.</span>
        <External href="https://github.com/OwenPawl/Basic-Needs-Finder">
          Project & sources
        </External>
      </footer>
      <dialog
        ref={dialog}
        className="resource-dialog"
        aria-labelledby="detail-title"
        onClose={() => setSelected(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        {selected && (
          <>
            <button
              autoFocus
              className="dialog-close"
              aria-label="Close resource details"
              onClick={() => setSelected(null)}
            >
              <X size={22} />
            </button>
            <p className="eyebrow">{areaNames[selected.area]}</p>
            <h2 id="detail-title">{selected.title}</h2>
            <p className="detail-provider">{selected.provider}</p>
            <p>{selected.summary}</p>
            <dl>
              <dt>Where</dt>
              <dd>{selected.place}</dd>
              <dt>Listed hours</dt>
              <dd>{selected.hours}</dd>
              <dt>What to know</dt>
              <dd>{selected.access}</dd>
            </dl>
            <p className="detail-note">{selected.note}</p>
            <div className="detail-actions">
              {selected.action && (
                <External className="button primary" href={selected.action.url}>
                  {selected.action.label}
                </External>
              )}
              {selected.directions && (
                <External
                  className="button secondary"
                  href={selected.directions}
                >
                  <MapPin size={17} />
                  Directions
                </External>
              )}
              <button
                className="button secondary"
                onClick={() => toggle(selected.id)}
              >
                {saved.includes(selected.id) ? (
                  <Check size={17} />
                ) : (
                  <Plus size={17} />
                )}{" "}
                {saved.includes(selected.id)
                  ? "Added to my plan"
                  : "Add to my plan"}
              </button>
            </div>
            <div className="source-box">
              <External href={selected.source}>Provider source</External>
              <span>Checked {checkedLabel}. Confirm before traveling.</span>
            </div>
          </>
        )}
      </dialog>
      <section className="print-plan">
        <h1>My WWU resource plan</h1>
        <p>
          Listed hours are not a food-availability guarantee. Confirm holiday
          and quarter-break changes with providers.
        </p>
        {planned.map((r) => (
          <article key={r.id}>
            <h2>{r.title}</h2>
            <p>
              {r.place} · {r.hours}
            </p>
            <p>
              {r.access} {r.note}
            </p>
            <p>
              Source (checked {r.checked}): {r.source}
            </p>
            {r.directions && <p>Directions: {r.directions}</p>}
            {r.action && (
              <p>
                {r.action.label}: {r.action.url}
              </p>
            )}
          </article>
        ))}
        <p>
          Campus map: https://map.wwu.edu/ · Bus planner:
          https://schedules.ridewta.com/
        </p>
      </section>
    </>
  );
}

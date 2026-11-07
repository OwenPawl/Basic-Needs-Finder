"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorCode, getSupabaseClient } from "@/lib/supabase";
import { authErrorMessage } from "@/lib/auth-errors";
import { parseSession, sessionStage, type Session } from "@/lib/session";
import styles from "./account.module.css";

type Step =
  | "loading"
  | "unavailable"
  | "email"
  | "code"
  | "profile"
  | "campus"
  | "verified";
type Campus = { slug: string; name: string };

const messages: Record<string, string> = {
  UNAUTHENTICATED: "Your sign-in expired. Please sign in again.",
  FORBIDDEN:
    "That email can’t be verified for this campus. Use your university email, and confirm it first.",
  NOT_FOUND: "We couldn’t find that campus.",
  VALIDATION_ERROR: "Please check the highlighted field.",
  INVALID_STATE:
    "This account needs a campus staff member to finish setup. Please contact your project organizer.",
};

function friendly(error: unknown, fallback: string) {
  const code = errorCode(error);
  return (code && messages[code]) || fallback;
}

export function Account() {
  const [step, setStep] = useState<Step>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [campus, setCampus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const supabase = useRef<SupabaseClient | null>(null);

  const go = useCallback((next: Step) => {
    setError("");
    setStep(next);
  }, []);

  // Move focus to the new step's heading so screen readers follow along.
  useEffect(() => {
    if (step !== "loading") heading.current?.focus({ preventScroll: true });
  }, [step]);

  const refresh = useCallback(async () => {
    const client = supabase.current;
    if (!client) return;
    const { data: auth } = await client.auth.getSession();
    if (!auth.session) return go("email");
    const { data, error: rpcError } = await client.rpc("my_session");
    if (rpcError) {
      go("email");
      setError(friendly(rpcError, "We couldn’t load your account."));
      return;
    }
    const parsed = parseSession(data);
    setSession(parsed);
    const stage = sessionStage(parsed);
    if (stage === "needs-profile") return go("profile");
    if (stage === "verified") return go("verified");
    const { data: list } = await client
      .from("Campus")
      .select("slug,name")
      .order("name");
    setCampuses((list as Campus[] | null) ?? []);
    go("campus");
  }, [go]);

  useEffect(() => {
    supabase.current = getSupabaseClient();
    if (!supabase.current) {
      setStep("unavailable");
      return;
    }
    void refresh().catch(() => {
      go("email");
      setError("We couldn’t load your account. Please try again.");
    });
  }, [go, refresh]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch {
      setError("We couldn’t finish that request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (event: { preventDefault(): void }) => {
    event.preventDefault();
    void run(async () => {
      const address = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        return setError("Enter a complete email address, such as yourname@wwu.edu.");
      }
      const { error: otpError } = await supabase.current!.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true },
      });
      if (otpError) return setError(authErrorMessage(otpError, "send"));
      setEmail(address);
      setCode("");
      setNotice(`We sent a sign-in code to ${address}. Use the latest email.`);
      go("code");
    });
  };

  const verifyCode = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { error: verifyError } = await supabase.current!.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: "email",
      });
      if (verifyError) return setError(authErrorMessage(verifyError, "verify"));
      setCode("");
      await refresh();
    });
  };

  const saveProfile = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { error: rpcError } = await supabase.current!.rpc(
        "upsert_profile",
        {
          display_name: name,
        },
      );
      if (rpcError)
        return setError(friendly(rpcError, "We couldn’t save your name."));
      await refresh();
    });
  };

  const verifyCampus = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { error: rpcError } = await supabase.current!.rpc(
        "verify_campus_membership",
        { campus_slug: campus },
      );
      if (rpcError)
        return setError(friendly(rpcError, "We couldn’t verify that campus."));
      await refresh();
    });
  };

  const signOut = () =>
    void run(async () => {
      await supabase.current!.auth.signOut();
      setSession(null);
      setEmail("");
      setNotice("You’re signed out.");
      go("email");
    });

  const membership = session?.memberships.find((m) => m.verified);

  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <a className={styles.back} href="../">
        <span aria-hidden="true">←</span> Back to the resource finder
      </a>
      <section className={styles.card} aria-labelledby="account-title">
        {step !== "loading" && step !== "unavailable" && (
          <ol className={styles.progress} aria-label="Account setup">
            {(["Sign in", "Your name", "Campus", "Done"] as const).map(
              (label, i) => {
                const order = {
                  email: 0,
                  code: 0,
                  profile: 1,
                  campus: 2,
                  verified: 3,
                } as Record<string, number>;
                const current = order[step] ?? -1;
                const state =
                  i < current ? "done" : i === current ? "current" : "todo";
                return (
                  <li
                    key={label}
                    className={styles[state]}
                    aria-current={state === "current" ? "step" : undefined}
                  >
                    <span className={styles.dot} aria-hidden="true">
                      {state === "done" ? "✓" : i + 1}
                    </span>
                    <span>{label}</span>
                  </li>
                );
              },
            )}
          </ol>
        )}

        <div className={styles.step} key={step}>
          {step === "loading" && (
            <div className={styles.loading} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" /> Loading
              your account…
            </div>
          )}

          {step === "unavailable" && (
            <>
              <h1 id="account-title" ref={heading} tabIndex={-1}>
                Accounts are coming soon
              </h1>
              <p className={styles.lede}>
                Live accounts aren’t connected in this preview. You can still
                use the resource finder without signing in.
              </p>
              <a className={styles.primary} href="../">
                Open the resource finder
              </a>
            </>
          )}

          {step === "email" && (
            <form onSubmit={sendCode} noValidate>
              <h1 id="account-title" ref={heading} tabIndex={-1}>
                Sign in with your university email
              </h1>
              <p className={styles.lede}>
                We’ll email you a sign-in code. No password needed.
              </p>
              <label className={styles.field}>
                <span>University email (required)</span>
                <input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "account-error" : undefined}
                />
              </label>
              <button
                className={styles.primary}
                disabled={busy || !email.includes("@")}
                aria-busy={busy}
              >
                {busy ? "Sending…" : "Email me a code"}
              </button>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={verifyCode} noValidate>
              <h1 id="account-title" ref={heading} tabIndex={-1}>
                Check your email
              </h1>
              <p className={styles.lede}>
                Enter the code we sent to <b>{email.trim()}</b>.
              </p>
              <label className={styles.field}>
                <span>Email code (required)</span>
                <input
                  className={styles.code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={10}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "account-error" : undefined}
                />
              </label>
              <button
                className={styles.primary}
                disabled={busy || code.length < 6}
                aria-busy={busy}
              >
                {busy ? "Checking…" : "Sign in"}
              </button>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => go("email")}
                >
                  Use a different email
                </button>
                <button
                  type="button"
                  className={styles.link}
                  disabled={busy}
                  onClick={sendCode}
                >
                  Send a new code
                </button>
              </div>
            </form>
          )}

          {step === "profile" && (
            <form onSubmit={saveProfile} noValidate>
              <h1 id="account-title" ref={heading} tabIndex={-1}>
                What should we call you?
              </h1>
              <p className={styles.lede}>
                Other students see this name on your posts. Your email stays
                private.
              </p>
              <label className={styles.field}>
                <span>Display name (required)</span>
                <input
                  autoComplete="nickname"
                  maxLength={60}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "account-error" : undefined}
                />
              </label>
              <button
                className={styles.primary}
                disabled={busy || !name.trim()}
                aria-busy={busy}
              >
                {busy ? "Saving…" : "Continue"}
              </button>
            </form>
          )}

          {step === "campus" && (
            <form onSubmit={verifyCampus} noValidate>
              <h1 id="account-title" ref={heading} tabIndex={-1}>
                Verify your campus
              </h1>
              <p className={styles.lede}>
                We check that your confirmed email belongs to the campus you
                choose.
              </p>
              <label className={styles.field}>
                <span>Campus (required)</span>
                <select
                  required
                  value={campus}
                  onChange={(e) => setCampus(e.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "account-error" : undefined}
                >
                  <option value="">Choose your campus</option>
                  {campuses.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={styles.primary}
                disabled={busy || !campus}
                aria-busy={busy}
              >
                {busy ? "Verifying…" : "Verify"}
              </button>
            </form>
          )}

          {step === "verified" && session?.user && membership && (
            <>
              <div className={styles.success} aria-hidden="true">
                ✓
              </div>
              <h1 id="account-title" ref={heading} tabIndex={-1}>
                Hi, {session.user.display_name}
              </h1>
              <p className={styles.lede}>
                You’re a verified {membership.role} at {membership.campus_name}
                {membership.campus_is_demo ? " (demo campus)" : ""}.
              </p>
              <dl className={styles.facts}>
                <div>
                  <dt>Campus</dt>
                  <dd>{membership.campus_name}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd className={styles.badge}>{membership.role}</dd>
                </div>
                {membership.staff_location_ids.length > 0 && (
                  <div>
                    <dt>Staff locations</dt>
                    <dd>{membership.staff_location_ids.length}</dd>
                  </div>
                )}
              </dl>
              <section
                className={styles.history}
                aria-labelledby="history-title"
              >
                <h2 id="history-title">Your activity</h2>
                <div className={styles.empty}>
                  <p>
                    <a href="../exchange/">Your offers and requests →</a>
                  </p>
                  <p>
                    <a href="../reservations/">
                      Reservations and pickup history →
                    </a>
                  </p>
                  <p>
                    <a href="../inbox/">Private messages →</a>
                  </p>
                  {membership.staff_location_ids.length > 0 && (
                    <p>
                      <a href="../staff/">Staff inventory and pickups →</a>
                    </p>
                  )}
                </div>
              </section>
              <button
                className={styles.secondary}
                onClick={signOut}
                disabled={busy}
              >
                Sign out
              </button>
            </>
          )}
        </div>

        <p className={styles.status} role="status" aria-live="polite">
          {notice}
        </p>
        {error && (
          <p id="account-error" className={styles.error} role="alert">
            {error}
          </p>
        )}
      </section>
      <p className={styles.footnote}>
        Independent student project. We never show your email to other students.
      </p>
    </main>
  );
}

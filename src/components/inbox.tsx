"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorCode, getSupabaseClient } from "@/lib/supabase";
import base from "./account.module.css";
import styles from "./inbox.module.css";

type Summary = {
  conversation_id: string;
  listing_id: string;
  listing_title: string;
  other_display_name: string | null;
  last_message: string | null;
  last_at: string;
};
type Message = {
  id: string;
  mine: boolean;
  sender_name: string;
  body: string;
  created_at: string;
};
type Thread = {
  conversation_id: string;
  listing_title: string;
  messages: Message[];
};
type View = "loading" | "unavailable" | "signed-out" | "ready";

const messages: Record<string, string> = {
  UNAUTHENTICATED: "Your sign-in expired. Please sign in again.",
  NOT_FOUND: "This conversation isn’t available.",
  VALIDATION_ERROR:
    "Messages need 1 to 2,000 characters. You can’t message your own listing.",
  INVALID_STATE: "This listing is no longer open for new conversations.",
  FORBIDDEN: "Verify your campus on your account page first.",
};
const friendly = (e: unknown, fallback: string) =>
  messages[errorCode(e) ?? ""] ?? fallback;
const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function Inbox() {
  const [view, setView] = useState<View>("loading");
  const [list, setList] = useState<Summary[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = useRef<SupabaseClient | null>(null);
  const requestKey = useRef("");
  const previousBody = useRef("");
  const sendingRef = useRef(false);
  const openRequest = useRef(0);
  const log = useRef<HTMLOListElement>(null);

  const loadList = useCallback(async () => {
    const { data, error: e } = await client.current!.rpc("my_conversations");
    if (e) return setError(friendly(e, "We couldn’t load your messages."));
    setList((data as Summary[]) ?? []);
  }, []);

  const open = useCallback(async (id: string) => {
    const request = ++openRequest.current;
    setError("");
    const { data, error: e } = await client.current!.rpc(
      "conversation_messages",
      { conversation_id: id },
    );
    if (request !== openRequest.current) return;
    if (e) return setError(friendly(e, "We couldn’t open that conversation."));
    setThread(data as Thread);
    const url = new URL(window.location.href);
    url.search = `?conversation=${id}`;
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    client.current = getSupabaseClient();
    if (!client.current) return setView("unavailable");
    void (async () => {
      const { data } = await client.current!.auth.getSession();
      if (!data.session) return setView("signed-out");
      setView("ready");
      await loadList();
      const params = new URLSearchParams(window.location.search);
      const listing = params.get("listing");
      const food = params.get("food");
      const conversation = params.get("conversation");
      if (food) {
        const { data: started, error: e } = await client.current!.rpc(
          "start_food_conversation",
          { post_id: food },
        );
        if (e)
          return setError(friendly(e, "We couldn’t start that conversation."));
        await loadList();
        await open(started.conversation_id);
      } else if (listing) {
        const { data: started, error: e } = await client.current!.rpc(
          "start_conversation",
          { listing_id: listing },
        );
        if (e)
          return setError(friendly(e, "We couldn’t start that conversation."));
        await loadList();
        await open(started.conversation_id);
      } else if (conversation) await open(conversation);
    })();
  }, [loadList, open]);

  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [thread]);

  useEffect(() => {
    if (view !== "ready") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadList();
        if (thread) void open(thread.conversation_id);
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [view, thread?.conversation_id, loadList, open]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!thread || !draft.trim() || sendingRef.current) return;
    sendingRef.current = true;
    const identity = thread.conversation_id + "/" + draft.trim();
    if (previousBody.current !== identity || !requestKey.current) {
      previousBody.current = identity;
      requestKey.current = crypto.randomUUID();
    }
    setBusy(true);
    setError("");
    const { data: sent, error: e } = await client.current!.rpc(
      "send_message_once",
      {
        conversation_id: thread.conversation_id,
        body: draft,
        idempotency_key: requestKey.current,
      },
    );
    setBusy(false);
    sendingRef.current = false;
    if (sent?.error)
      return setError(
        friendly(
          { message: sent.error.code },
          "Your message was not confirmed. Try again.",
        ),
      );
    if (e) return setError(friendly(e, "Your message wasn’t sent. Try again."));
    requestKey.current = "";
    setDraft("");
    await open(thread.conversation_id);
    await loadList();
  }

  return (
    <main className={base.page}>
      <div className={base.glow} aria-hidden="true" />
      <a className={`${base.back} ${styles.wide}`} href="../">
        <span aria-hidden="true">←</span> Back to Basic Needs Finder
      </a>
      <section
        className={`${base.card} ${styles.card}`}
        aria-labelledby="inbox-title"
      >
        <div className={base.step}>
          <h1 id="inbox-title">Messages</h1>
          {view === "loading" && (
            <p className={base.loading} role="status">
              <span className={base.spinner} aria-hidden="true" /> Loading your
              messages…
            </p>
          )}
          {view === "unavailable" && (
            <p className={base.lede}>
              Live accounts aren’t connected in this preview, so messaging is
              off.
            </p>
          )}
          {view === "signed-out" && (
            <>
              <p className={base.lede}>
                Sign in to message other students about a listing.
              </p>
              <a className={base.primary} href="../account/">
                Sign in
              </a>
            </>
          )}
          {view === "ready" && (
            <div className={styles.layout}>
              <nav
                aria-label="Conversations"
                className={thread ? styles.listHiddenSmall : undefined}
              >
                {list.length === 0 ? (
                  <div className={base.empty}>
                    <p>
                      <b>No conversations yet.</b>
                    </p>
                    <p>Open a listing and choose “Message” to ask about it.</p>
                  </div>
                ) : (
                  <ul className={styles.list}>
                    {list.map((c) => (
                      <li key={c.conversation_id}>
                        <button
                          className={styles.item}
                          aria-current={
                            thread?.conversation_id === c.conversation_id
                              ? "true"
                              : undefined
                          }
                          onClick={() => void open(c.conversation_id)}
                        >
                          <span className={styles.itemTitle}>
                            {c.listing_title}
                          </span>
                          <span className={styles.itemMeta}>
                            {c.other_display_name ?? "Student"} ·{" "}
                            <time dateTime={c.last_at}>{time(c.last_at)}</time>
                          </span>
                          {c.last_message && (
                            <span className={styles.preview}>
                              {c.last_message}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </nav>
              {thread && (
                <section
                  className={styles.thread}
                  aria-labelledby="thread-title"
                >
                  <button
                    className={`${base.link} ${styles.backSmall}`}
                    onClick={() => setThread(null)}
                  >
                    ← All conversations
                  </button>
                  <h2 id="thread-title">{thread.listing_title}</h2>
                  <ol
                    className={styles.log}
                    ref={log}
                    role="log"
                    aria-live="polite"
                    aria-label="Messages"
                  >
                    {thread.messages.map((m) => (
                      <li
                        key={m.id}
                        className={m.mine ? styles.mine : styles.theirs}
                      >
                        <span className={styles.sender}>
                          {m.mine ? "You" : m.sender_name}
                        </span>
                        <p>{m.body}</p>
                        <time dateTime={m.created_at}>
                          {time(m.created_at)}
                        </time>
                      </li>
                    ))}
                  </ol>
                  <form onSubmit={send} className={styles.composer}>
                    <label className={base.field}>
                      <span>Message</span>
                      <textarea
                        rows={3}
                        maxLength={2000}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                            void send(e);
                        }}
                        aria-describedby="composer-help"
                      />
                    </label>
                    <p id="composer-help" className={styles.help}>
                      Don’t share personal contact details. Meet only at the
                      listed campus location. Ctrl/⌘+Enter sends. Messages
                      refresh every 10 seconds.
                    </p>
                    <button
                      className={base.primary}
                      disabled={busy || !draft.trim()}
                      aria-busy={busy}
                    >
                      {busy ? "Sending…" : "Send"}
                    </button>
                  </form>
                </section>
              )}
            </div>
          )}
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

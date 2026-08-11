"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * AI Packaging Expert — customer-facing chat surface (Session 05).
 *
 * Positioning: a packaging expert that makes buying easier — never "AI
 * chatbot" (AI_AGENT_ARCHITECTURE.md UX rules). The client renders ONLY
 * normalized server responses: reply text, an optional validated product
 * recommendation path, and the handoff state. It never parses model prose
 * for actions and never sends anything but the message text — identity is
 * the httpOnly session cookie.
 */

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Validated recommendation attached to an assistant reply. */
  productPath?: string;
  /** Local-only render hint for failure copy. */
  notice?: boolean;
};

type ChatResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  retryAfterSeconds?: number;
  reply?: string;
  recommendedProductPath?: string;
  needsHuman?: boolean;
  conversationStatus?: "active" | "escalated";
};

const QUICK_PROMPTS = [
  "I run a restaurant.",
  "I need 5,000 custom bags.",
  "Help me choose a size.",
  "Can you print my logo?",
  "What's the lowest-cost option?",
  "How long does shipping take?",
];

const NETWORK_ERROR_COPY =
  "Something went wrong sending that. Check your connection and try again — or configure your bags directly on any product page.";

export function PackagingExpertChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const [retryText, setRetryText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (historyLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai/chat", { method: "GET" });
        const data = (await res.json()) as {
          ok: boolean;
          conversation?: { status: string; messages: { role: "user" | "assistant"; content: string }[] } | null;
        };
        if (cancelled || !data.ok || !data.conversation) return;
        setMessages(data.conversation.messages.map((m) => ({ role: m.role, content: m.content })));
        setEscalated(data.conversation.status === "escalated");
      } catch {
        // History is a convenience — a failed load just starts fresh.
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, historyLoaded]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = useCallback(
    async (text: string, isRetry = false) => {
      const trimmed = text.trim();
      if (trimmed === "" || busy) return;
      setNotice(null);
      setRetryText(null);
      if (!isRetry) {
        setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      }
      setBusy(true);
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
        });
        const data = (await res.json()) as ChatResponse;
        if (data.ok && data.reply) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.reply as string, productPath: data.recommendedProductPath },
          ]);
          if (data.needsHuman || data.conversationStatus === "escalated") setEscalated(true);
        } else if (data.code === "RATE_LIMITED") {
          setNotice(data.message ?? "You're sending messages very quickly — give it a moment.");
          setRetryText(trimmed);
        } else {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", notice: true, content: data.message ?? NETWORK_ERROR_COPY },
          ]);
        }
      } catch {
        setNotice(NETWORK_ERROR_COPY);
        setRetryText(trimmed);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input;
    setInput("");
    void send(text);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="packaging-expert-panel"
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-3 font-display text-sm font-semibold text-accent-ink shadow-lg transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        {open ? "Close" : "Ask Our Packaging Expert"}
      </button>

      {open && (
        <section
          id="packaging-expert-panel"
          aria-label="Packaging Expert chat"
          className="fixed bottom-20 right-2 z-40 flex max-h-[min(75vh,600px)] w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-md border border-rule-2 bg-paper shadow-2xl sm:right-4 sm:w-[380px]"
        >
          <header className="flex items-center justify-between border-b border-rule bg-paper-2 px-4 py-3">
            <div>
              <p className="font-display text-sm font-semibold text-ink">Packaging Expert</p>
              <p className="text-xs text-ink-3">Sizes, printing, pricing &amp; ordering</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="rounded-sm p-1 text-ink-3 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          {escalated && (
            <p className="border-b border-rule bg-accent-soft px-4 py-2 text-xs text-ink-2" role="status">
              A human teammate has been looped in and will follow up. You can keep chatting here, or send details via{" "}
              <Link href="/request-quote" className="font-medium text-accent underline">
                the quote form
              </Link>
              .
            </p>
          )}

          <div ref={logRef} role="log" aria-live="polite" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && !busy && (
              <div>
                <p className="mb-2 text-sm text-ink-2">
                  Hi — I help restaurants and cafes choose custom takeout bags: sizes, logo printing, volume pricing,
                  and ordering. What are you working with?
                </p>
                <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
                  {QUICK_PROMPTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void send(q)}
                      className="rounded-full border border-rule-2 bg-paper-2 px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-md bg-accent px-3 py-2 text-sm text-accent-ink"
                      : m.notice
                        ? "max-w-[85%] rounded-md border border-rule bg-paper-2 px-3 py-2 text-sm italic text-ink-3"
                        : "max-w-[85%] rounded-md border border-rule bg-paper-2 px-3 py-2 text-sm text-ink"
                  }
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.productPath && (
                    <Link
                      href={m.productPath}
                      className="mt-2 inline-block rounded-sm bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink no-underline hover:bg-accent-hover"
                    >
                      Configure this bag →
                    </Link>
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <p className="text-xs text-ink-3" role="status">
                Packaging Expert is thinking…
              </p>
            )}
          </div>

          {notice && (
            <div className="flex items-center justify-between gap-2 border-t border-rule bg-error-soft px-4 py-2">
              <p className="text-xs text-ink-2">{notice}</p>
              {retryText && (
                <button
                  type="button"
                  onClick={() => void send(retryText, true)}
                  className="shrink-0 rounded-sm border border-rule-2 px-2 py-1 text-xs font-medium text-ink transition-colors hover:border-accent hover:text-accent"
                >
                  Try again
                </button>
              )}
            </div>
          )}

          <form onSubmit={submit} className="flex items-end gap-2 border-t border-rule bg-paper px-3 py-3">
            <label htmlFor="packaging-expert-input" className="sr-only">
              Message the Packaging Expert
            </label>
            <textarea
              id="packaging-expert-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const text = input;
                  setInput("");
                  void send(text);
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="e.g. 5,000 large black bags with our logo"
              className="max-h-28 min-h-[2.5rem] flex-1 resize-y rounded-sm border border-rule-2 bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || input.trim() === ""}
              className="btn btn--primary !px-4 !py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>
      )}
    </>
  );
}

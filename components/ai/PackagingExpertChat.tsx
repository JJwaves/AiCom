"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/analytics/track";
import { useCart } from "@/lib/cart/cart-context";
import { persistMockOrderPayload, submitCartCheckout } from "@/lib/cart/checkout-client";
import {
  isConfiguratorMounted,
  publishAiConfigurationUpdate,
  subscribeToConfiguratorPresence,
} from "@/lib/configuration/sync-bus";
import type { ProductConfiguration } from "@/types/commerce";

/**
 * AI Packaging Expert — customer-facing chat surface (Session 05; shared-
 * configuration integration Session 06; cart/checkout assistance Session 07).
 *
 * Positioning: a packaging expert that makes buying easier — never "AI
 * chatbot" (AI_AGENT_ARCHITECTURE.md UX rules). The client renders ONLY
 * normalized server responses: reply text, an optional validated product
 * recommendation path, committed configuration updates, proposed apply
 * actions, validated cart lines, the checkout handoff, and the handoff
 * state. It never parses model prose for actions; requests carry the
 * message text plus a price-free snapshot of the client cart (identity is
 * the httpOnly session cookie).
 *
 * Commerce authority (S07): a `cartAdd` payload is the SERVER's validated,
 * engine-priced line for the session's authoritative configuration — the
 * client adds exactly that line through the same useCart().addLine the
 * manual configurator uses. "Add to cart" chips re-validate at tap time via
 * /api/cart/line (repriced/stale answers require the customer to confirm
 * again). "Continue to checkout" runs the SAME shared submitCartCheckout
 * path as the cart page — /api/checkout re-quotes everything, REPRICED is
 * shown and must be confirmed, and the only navigation targets are the
 * app's own order page or the provider URL the server returned.
 */

type WireConfigurationUpdate = {
  productId: string;
  productTitle: string;
  config: ProductConfiguration;
  revision: number;
  changedFields: string[];
  changeSummary: { field: string; value: string }[];
  price: { unitPriceCents: number; totalCents: number; currency: string; pricingStatus: "DEMO" | "LIVE" } | null;
  requiresCustomQuote: boolean;
};

type WirePrice = { unitPriceCents: number; totalCents: number; currency: string; pricingStatus: "DEMO" | "LIVE" };

type WireConfigAction = {
  type: "APPLY_CONFIGURATION_PATCH";
  productId: string;
  productPath: string;
  label: string;
  patch: Record<string, string | number>;
  basedOnRevision: number;
  preview: WirePrice | null;
};

type WireCartAction = {
  type: "ADD_TO_CART";
  productId: string;
  label: string;
  basedOnRevision: number;
  price: WirePrice;
  summary: string;
};

type WireSuggestedAction = WireConfigAction | WireCartAction;

type WireCartAdd = {
  productId: string;
  productTitle: string;
  line: {
    config: ProductConfiguration;
    unitPriceCents: number;
    totalCents: number;
    title: string;
    optionSummary: string;
  };
  revision: number;
  currency: string;
  pricingStatus: "DEMO" | "LIVE";
};

type WireCheckoutAction = {
  type: "CONTINUE_TO_CHECKOUT";
  lineCount: number;
  subtotalCents: number;
  currency: string;
  pricingStatus: "DEMO" | "LIVE";
};

type ConfigSuggestionState = WireConfigAction & { status: "idle" | "applying" | "applied" | "stale" };

type CartSuggestionState = WireCartAction & {
  status: "idle" | "applying" | "added" | "repriced" | "stale" | "blocked";
  /** Set when status = repriced: the validated CURRENT price to confirm. */
  currentPrice?: WirePrice;
  currentRevision?: number;
  /** Short customer-safe copy for blocked states. */
  blockedReason?: string;
};

type SuggestionState = ConfigSuggestionState | CartSuggestionState;

type CheckoutState = {
  action: WireCheckoutAction;
  status: "idle" | "submitting" | "repriced" | "error";
  /** Corrected subtotal after a REPRICED answer — confirm at this number. */
  repricedSubtotalCents?: number;
  errorText?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Validated recommendation attached to an assistant reply. */
  productPath?: string;
  /** Committed configuration change (server-validated) for the confirmation chip. */
  configUpdate?: WireConfigurationUpdate;
  /** Proposed-but-uncommitted actions the customer can accept. */
  suggestions?: SuggestionState[];
  /** Server-validated line that was just added to the cart (S07). */
  cartAdd?: WireCartAdd;
  /** Checkout handoff the customer confirms (S07). */
  checkout?: CheckoutState;
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
  configurationUpdate?: WireConfigurationUpdate;
  suggestedActions?: WireSuggestedAction[];
  cartAdd?: WireCartAdd;
  checkoutAction?: WireCheckoutAction;
  needsHuman?: boolean;
  conversationStatus?: "active" | "escalated";
};

type CartLineResponse = {
  ok: boolean;
  code?: string;
  status?: string;
  line?: WireCartAdd["line"];
  currentPrice?: WirePrice;
  revision?: number;
  printLabel?: string;
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

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

export function PackagingExpertChat() {
  const router = useRouter();
  const { cart, addLine, updateQuantity } = useCart();
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

  // A mounted configurator implies the sticky Add-to-Cart bar on mobile —
  // lift the launcher and panel above it (spec: chat must not cover the CTA).
  const configuratorPresent = useSyncExternalStore(
    subscribeToConfiguratorPresence,
    () => isConfiguratorMounted(),
    () => false,
  );

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

  /** Price-free snapshot of the client cart — the agent's only window into it. */
  const cartSnapshot = () => ({
    lines: cart.lines.slice(0, 50).map((l) => ({
      lineId: l.lineId,
      productId: l.config.productId,
      sizeId: l.config.sizeId,
      materialId: l.config.materialId,
      colorId: l.config.colorId,
      printOptionId: l.config.printOptionId,
      quantity: l.config.quantity,
      hasArtwork: Boolean(l.config.artwork),
    })),
  });

  /** Apply a SERVER-validated cart line to the shared cart — the same addLine the configurator uses. */
  const applyCartAdd = useCallback(
    (add: WireCartAdd) => {
      addLine(add.line);
      track({
        name: "add_to_cart",
        params: {
          items: [
            {
              product_id: add.productId,
              product_name: add.line.title,
              variant: add.line.optionSummary,
              quantity: add.line.config.quantity,
              unit_price: add.line.unitPriceCents / 100,
            },
          ],
          value: add.line.totalCents / 100,
          currency: add.currency,
          added_via: "ai_chat",
        },
      });
    },
    [addLine],
  );

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
          body: JSON.stringify({ message: trimmed, cart: cartSnapshot() }),
        });
        const data = (await res.json()) as ChatResponse;
        if (data.ok && data.reply) {
          if (data.configurationUpdate) {
            // Server-validated state → the shared store (no-op when the
            // product's configurator isn't mounted; the DB row is synced).
            publishAiConfigurationUpdate({
              productId: data.configurationUpdate.productId,
              config: data.configurationUpdate.config,
              revision: data.configurationUpdate.revision,
            });
          }
          if (data.cartAdd) {
            // Explicit customer intent already established in conversation;
            // the payload is the server's validated engine-priced line.
            applyCartAdd(data.cartAdd);
          }
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: data.reply as string,
              productPath: data.recommendedProductPath,
              configUpdate: data.configurationUpdate,
              suggestions: data.suggestedActions?.map((s) => ({ ...s, status: "idle" as const })),
              cartAdd: data.cartAdd,
              checkout: data.checkoutAction ? { action: data.checkoutAction, status: "idle" as const } : undefined,
            },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cartSnapshot reads `cart`
    [busy, applyCartAdd, cart],
  );

  const setSuggestionState = useCallback(
    (messageIndex: number, actionIndex: number, update: { status: SuggestionState["status"] } & Partial<Omit<CartSuggestionState, "status" | "type">>) => {
      setMessages((prev) =>
        prev.map((m, mi) =>
          mi === messageIndex && m.suggestions
            ? {
                ...m,
                suggestions: m.suggestions.map((s, si) => (si === actionIndex ? ({ ...s, ...update } as SuggestionState) : s)),
              }
            : m,
        ),
      );
    },
    [],
  );

  /** Apply a proposed configuration change — server re-validates against CURRENT state. */
  const applyConfigSuggestion = useCallback(
    async (messageIndex: number, actionIndex: number, action: ConfigSuggestionState) => {
      if (action.status === "applying" || action.status === "applied") return;
      setSuggestionState(messageIndex, actionIndex, { status: "applying" });
      try {
        const res = await fetch("/api/configuration", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ productId: action.productId, patch: action.patch }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          configuration?: { config: ProductConfiguration; revision: number } | null;
        };
        if (res.ok && data.ok && data.configuration) {
          publishAiConfigurationUpdate({
            productId: action.productId,
            config: data.configuration.config,
            revision: data.configuration.revision,
          });
          setSuggestionState(messageIndex, actionIndex, { status: "applied" });
        } else {
          setSuggestionState(messageIndex, actionIndex, { status: "stale" });
        }
      } catch {
        setSuggestionState(messageIndex, actionIndex, { status: "idle" });
        setNotice(NETWORK_ERROR_COPY);
      }
    },
    [setSuggestionState],
  );

  /**
   * Accept an "Add to cart" offer — /api/cart/line re-validates the CURRENT
   * authoritative configuration; repriced/stale answers require another
   * explicit tap at the corrected state.
   */
  const applyCartSuggestion = useCallback(
    async (messageIndex: number, actionIndex: number, action: CartSuggestionState) => {
      if (action.status === "applying" || action.status === "added") return;
      const expectedRevision = action.status === "repriced" ? action.currentRevision ?? action.basedOnRevision : action.basedOnRevision;
      const expectedTotalCents = action.status === "repriced" && action.currentPrice ? action.currentPrice.totalCents : action.price.totalCents;
      setSuggestionState(messageIndex, actionIndex, { status: "applying" });
      try {
        const res = await fetch("/api/cart/line", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ productId: action.productId, expectedRevision, expectedTotalCents }),
        });
        const data = (await res.json()) as CartLineResponse;
        if (res.ok && data.ok && data.status === "prepared" && data.line) {
          applyCartAdd({
            productId: action.productId,
            productTitle: data.line.title,
            line: data.line,
            revision: data.revision ?? expectedRevision,
            currency: action.price.currency,
            pricingStatus: action.price.pricingStatus,
          });
          setSuggestionState(messageIndex, actionIndex, { status: "added" });
        } else if (data.code === "REPRICED" && data.currentPrice) {
          setSuggestionState(messageIndex, actionIndex, {
            status: "repriced",
            currentPrice: data.currentPrice,
            currentRevision: data.revision,
          });
        } else if (data.code === "ARTWORK_REQUIRED") {
          setSuggestionState(messageIndex, actionIndex, {
            status: "blocked",
            blockedReason: "A logo file is needed first — upload it in the configurator.",
          });
        } else if (data.code === "CUSTOM_QUOTE_REQUIRED") {
          setSuggestionState(messageIndex, actionIndex, {
            status: "blocked",
            blockedReason: "This configuration needs a custom quote instead.",
          });
        } else {
          setSuggestionState(messageIndex, actionIndex, { status: "stale" });
        }
      } catch {
        setSuggestionState(messageIndex, actionIndex, { status: "idle" });
        setNotice(NETWORK_ERROR_COPY);
      }
    },
    [applyCartAdd, setSuggestionState],
  );

  const setCheckoutState = useCallback((messageIndex: number, update: Partial<CheckoutState> & { status: CheckoutState["status"] }) => {
    setMessages((prev) =>
      prev.map((m, mi) => (mi === messageIndex && m.checkout ? { ...m, checkout: { ...m.checkout, ...update } } : m)),
    );
  }, []);

  /**
   * Customer-confirmed checkout handoff — the SAME shared path as the cart
   * page's Checkout button. REPRICED updates the cart to the server's
   * numbers and requires another explicit confirmation tap.
   */
  const continueToCheckout = useCallback(
    async (messageIndex: number, state: CheckoutState) => {
      if (state.status === "submitting") return;
      const lines = cart.lines;
      if (lines.length === 0) {
        setCheckoutState(messageIndex, { status: "error", errorText: "Your cart is empty — add the configured bag first." });
        return;
      }
      setCheckoutState(messageIndex, { status: "submitting" });
      track({
        name: "begin_checkout",
        params: {
          items: lines.map((l) => ({
            product_id: l.config.productId,
            product_name: l.title,
            variant: l.optionSummary,
            quantity: l.config.quantity,
            unit_price: l.unitPriceCents / 100,
          })),
          value: lines.reduce((s, l) => s + l.totalCents, 0) / 100,
          currency: cart.currency,
          trigger: "ai_chat",
        },
      });
      const result = await submitCartCheckout(lines);
      switch (result.kind) {
        case "mock-order":
          persistMockOrderPayload(result.orderId, result.order);
          setCheckoutState(messageIndex, { status: "idle" });
          setOpen(false);
          router.push(`/order-status?order=${result.orderId}&placed=1`);
          return;
        case "redirect":
          // Server/provider-generated checkout URL — the only external
          // navigation this widget ever performs.
          window.location.href = result.url;
          return;
        case "repriced": {
          for (const l of result.lines) updateQuantity(l.lineId, l.quantity, l.unitPriceCents);
          const repricedSubtotalCents = result.lines.reduce((s, l) => s + l.totalCents, 0);
          setCheckoutState(messageIndex, { status: "repriced", repricedSubtotalCents });
          return;
        }
        case "invalid":
        case "error":
          setCheckoutState(messageIndex, { status: "error", errorText: result.message });
          return;
      }
    },
    [cart, router, setCheckoutState, updateQuantity],
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
        className={`fixed right-4 z-40 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-3 font-display text-sm font-semibold text-accent-ink shadow-lg transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          configuratorPresent ? "bottom-24 lg:bottom-4" : "bottom-4"
        }`}
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
          className={`fixed right-2 z-40 flex w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-md border border-rule-2 bg-paper shadow-2xl sm:right-4 sm:w-[380px] ${
            configuratorPresent
              ? "bottom-[9.5rem] max-h-[min(60vh,600px)] lg:bottom-20 lg:max-h-[min(75vh,600px)]"
              : "bottom-20 max-h-[min(75vh,600px)]"
          }`}
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

                  {m.configUpdate && (
                    <div className="mt-2 rounded-sm border border-rule bg-ok-soft px-2.5 py-1.5 text-xs text-ink" role="status">
                      <p className="font-medium">
                        ✓ Configurator updated
                        {!isConfiguratorMounted(m.configUpdate.productId) && ` — ${m.configUpdate.productTitle}`}
                      </p>
                      <p className="mt-0.5 text-ink-2">
                        {m.configUpdate.changeSummary.map((c) => `${c.field} → ${c.value}`).join(" · ")}
                        {m.configUpdate.price &&
                          ` · ${money(m.configUpdate.price.totalCents, m.configUpdate.price.currency)} total${
                            m.configUpdate.price.pricingStatus === "DEMO" ? " (demo pricing)" : ""
                          }`}
                        {m.configUpdate.requiresCustomQuote && " · priced via custom quote"}
                      </p>
                    </div>
                  )}

                  {m.cartAdd && (
                    <div className="mt-2 rounded-sm border border-rule bg-ok-soft px-2.5 py-1.5 text-xs text-ink" role="status">
                      <p className="font-medium">✓ Added to your cart</p>
                      <p className="mt-0.5 text-ink-2">
                        {m.cartAdd.line.title} · {m.cartAdd.line.optionSummary} ·{" "}
                        {m.cartAdd.line.config.quantity.toLocaleString("en-US")} ×{" "}
                        {money(m.cartAdd.line.unitPriceCents, m.cartAdd.currency)} ={" "}
                        {money(m.cartAdd.line.totalCents, m.cartAdd.currency)}
                        {m.cartAdd.pricingStatus === "DEMO" && " (demo pricing)"}
                      </p>
                      <Link href="/cart" className="mt-1 inline-block font-medium text-accent underline">
                        View cart →
                      </Link>
                    </div>
                  )}

                  {m.suggestions?.map((s, si) => (
                    <div key={si} className="mt-2">
                      {s.type === "APPLY_CONFIGURATION_PATCH" ? (
                        s.status === "applied" ? (
                          <p className="inline-block rounded-sm bg-ok-soft px-2.5 py-1 text-xs font-medium text-ink" role="status">
                            ✓ Applied
                            {!isConfiguratorMounted(s.productId) && (
                              <>
                                {" — "}
                                <Link href={s.productPath} className="text-accent underline">
                                  view in configurator →
                                </Link>
                              </>
                            )}
                          </p>
                        ) : s.status === "stale" ? (
                          <p className="inline-block rounded-sm bg-error-soft px-2.5 py-1 text-xs text-ink-2" role="status">
                            That suggestion no longer matches your configuration — ask me to refresh it.
                          </p>
                        ) : (
                          <button
                            type="button"
                            disabled={s.status === "applying"}
                            onClick={() => void applyConfigSuggestion(i, si, s)}
                            className="inline-block rounded-sm bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60"
                          >
                            {s.status === "applying" ? "Applying…" : s.label}
                            {s.preview &&
                              ` · ${money(s.preview.totalCents, s.preview.currency)}${s.preview.pricingStatus === "DEMO" ? " (demo)" : ""}`}
                          </button>
                        )
                      ) : s.status === "added" ? (
                        <p className="inline-block rounded-sm bg-ok-soft px-2.5 py-1 text-xs font-medium text-ink" role="status">
                          ✓ Added to your cart —{" "}
                          <Link href="/cart" className="text-accent underline">
                            view cart →
                          </Link>
                        </p>
                      ) : s.status === "stale" ? (
                        <p className="inline-block rounded-sm bg-error-soft px-2.5 py-1 text-xs text-ink-2" role="status">
                          Your configuration changed since this offer — ask me to refresh it.
                        </p>
                      ) : s.status === "blocked" ? (
                        <p className="inline-block rounded-sm bg-error-soft px-2.5 py-1 text-xs text-ink-2" role="status">
                          {s.blockedReason}
                        </p>
                      ) : s.status === "repriced" && s.currentPrice ? (
                        <div className="rounded-sm border border-rule bg-error-soft px-2.5 py-1.5 text-xs text-ink" role="status">
                          <p>
                            Price updated: was {money(s.price.totalCents, s.price.currency)}, now{" "}
                            <span className="font-semibold">{money(s.currentPrice.totalCents, s.currentPrice.currency)}</span>
                            {s.currentPrice.pricingStatus === "DEMO" && " (demo)"}
                          </p>
                          <button
                            type="button"
                            onClick={() => void applyCartSuggestion(i, si, s)}
                            className="mt-1 inline-block rounded-sm bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                          >
                            Add at {money(s.currentPrice.totalCents, s.currentPrice.currency)}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={s.status === "applying"}
                          onClick={() => void applyCartSuggestion(i, si, s)}
                          className="inline-block rounded-sm bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60"
                        >
                          {s.status === "applying" ? "Adding…" : s.label}
                          {` · ${money(s.price.totalCents, s.price.currency)}${s.price.pricingStatus === "DEMO" ? " (demo)" : ""}`}
                        </button>
                      )}
                    </div>
                  ))}

                  {m.checkout && (
                    <div className="mt-2">
                      {m.checkout.status === "repriced" ? (
                        <div className="rounded-sm border border-rule bg-error-soft px-2.5 py-1.5 text-xs text-ink" role="status">
                          <p>
                            Prices were updated to current values — your cart now totals{" "}
                            <span className="font-semibold">
                              {money(m.checkout.repricedSubtotalCents ?? 0, m.checkout.action.currency)}
                            </span>
                            .
                          </p>
                          <button
                            type="button"
                            onClick={() => void continueToCheckout(i, m.checkout as CheckoutState)}
                            className="mt-1 inline-block rounded-sm bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                          >
                            Confirm &amp; continue at {money(m.checkout.repricedSubtotalCents ?? 0, m.checkout.action.currency)}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={m.checkout.status === "submitting"}
                            onClick={() => void continueToCheckout(i, m.checkout as CheckoutState)}
                            className="inline-block rounded-sm bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60"
                          >
                            {m.checkout.status === "submitting"
                              ? "Opening checkout…"
                              : `Continue to checkout · ${money(m.checkout.action.subtotalCents, m.checkout.action.currency)}${
                                  m.checkout.action.pricingStatus === "DEMO" ? " (demo)" : ""
                                }`}
                          </button>
                          {m.checkout.status === "error" && m.checkout.errorText && (
                            <p className="mt-1 rounded-sm bg-error-soft px-2.5 py-1 text-xs text-ink-2" role="status">
                              {m.checkout.errorText}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}

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

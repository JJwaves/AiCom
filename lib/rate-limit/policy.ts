/**
 * Route-class rate-limit policy (Production Launch Session 03 §12, §15).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ROUTE CLASSES — what "too many" costs
 * ─────────────────────────────────────────────────────────────────────────
 * PUBLIC_LOW_COST      unauthenticated, no write, no external call. Abuse
 *                      costs CPU. Generous limits.
 * PUBLIC_DB_WRITE      unauthenticated and writes rows. Abuse costs storage
 *                      and pollutes first-party analytics. Bounded.
 * PUBLIC_EXTERNAL_COST unauthenticated and causes a metered third-party
 *                      effect — an Anthropic call, a Shopify draft order, an
 *                      object-storage capability. Abuse costs MONEY, or
 *                      creates records a human must clean up. Tight.
 * AUTHENTICATED        behind admin auth. The credential is the control;
 *                      limits exist to bound a runaway script, not a
 *                      stranger.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW THE NUMBERS WERE CHOSEN
 * ─────────────────────────────────────────────────────────────────────────
 * Every limit below is set from the shape of LEGITIMATE use, then widened
 * for the worst honest case, and only then compared against the abuse cost.
 * The B2B buyer this business serves is explicitly protected: a purchasing
 * manager configuring six line items, uploading six logos and checking out
 * must never meet a limit. That is why checkout is per-CHECKOUT (one request
 * regardless of line count) rather than per line, and why the artwork
 * allowance is a working session's worth of files, not a token gesture.
 *
 * These are the code-level defaults. They are NOT a substitute for the
 * platform/WAF layer (§14) — see docs/OBSERVABILITY.md.
 */

export type RouteClass = "PUBLIC_LOW_COST" | "PUBLIC_DB_WRITE" | "PUBLIC_EXTERNAL_COST" | "AUTHENTICATED";

export type ScopeLimit = {
  /** Burst allowance. */
  capacity: number;
  /** Sustained refill, requests per minute. */
  refillPerMinute: number;
};

export type RateLimitPolicy = {
  routeClass: RouteClass;
  /** Per first-party session. Null = this scope does not apply. */
  session: ScopeLimit | null;
  /** Per keyed network digest. Wider than the session scope because of NAT. */
  network: ScopeLimit | null;
  /**
   * Whether the durable shared-store layer is consulted in addition to the
   * per-instance bucket. Reserved for routes where a multi-instance bypass
   * actually costs something.
   */
  durable: boolean;
  /** Customer-facing copy for a 429 on this route. Never mentions internals. */
  message: string;
};

export const RATE_LIMIT_ROUTES = [
  "events",
  "configuration",
  "cart_line",
  "quote",
  "checkout",
  "artwork_upload",
  "artwork_complete",
  "ai_chat",
  "admin_write",
] as const;

export type RateLimitRoute = (typeof RATE_LIMIT_ROUTES)[number];

const TOO_FAST = "You're sending requests very quickly — wait a moment and try again.";

export const RATE_LIMIT_POLICIES: Record<RateLimitRoute, RateLimitPolicy> = {
  /**
   * First-party analytics intake. A real browsing session batches up to 20
   * events per flush and flushes a few times a minute; 120/min per session is
   * roughly ten times an energetic human. Durable: this is the endpoint the
   * production audit named as unauthenticated and unbounded, and a
   * multi-instance bypass writes rows.
   */
  events: {
    routeClass: "PUBLIC_DB_WRITE",
    session: { capacity: 60, refillPerMinute: 120 },
    network: { capacity: 200, refillPerMinute: 400 },
    durable: true,
    message: TOO_FAST,
  },

  /** Configurator sync — debounced client-side; a fast fiddler produces a few per second in bursts. */
  configuration: {
    routeClass: "PUBLIC_DB_WRITE",
    session: { capacity: 40, refillPerMinute: 90 },
    network: { capacity: 150, refillPerMinute: 300 },
    durable: true,
    message: TOO_FAST,
  },

  /** "Add to cart" from a chat chip. Human-paced by construction. */
  cart_line: {
    routeClass: "PUBLIC_DB_WRITE",
    session: { capacity: 20, refillPerMinute: 40 },
    network: { capacity: 80, refillPerMinute: 160 },
    durable: true,
    message: TOO_FAST,
  },

  /**
   * Custom-quote intake: a DB write AND an outbound webhook to the owner's
   * inbox. Nobody legitimately submits ten quote forms a minute, and the
   * failure mode of a loose limit is the owner's inbox as a spam target.
   */
  quote: {
    routeClass: "PUBLIC_EXTERNAL_COST",
    session: { capacity: 5, refillPerMinute: 5 },
    network: { capacity: 15, refillPerMinute: 15 },
    durable: true,
    message: "We've received several requests from you already — give it a minute before sending another.",
  },

  /**
   * CHECKOUT — creates a Shopify DRAFT ORDER, i.e. a record in the owner's
   * admin that a human may have to clean up, against an API with its own
   * quota. One request covers the whole cart however many lines it has, so
   * even an unusually indecisive B2B buyer re-confirming a repriced cart
   * several times stays well inside 8.
   */
  checkout: {
    routeClass: "PUBLIC_EXTERNAL_COST",
    session: { capacity: 8, refillPerMinute: 8 },
    network: { capacity: 30, refillPerMinute: 30 },
    durable: true,
    message: "Checkout is being retried too quickly. Wait a few seconds and try again — nothing was charged.",
  },

  /**
   * Minting a signed upload URL is minting a capability to create an object
   * in the owner's bucket. Sized for a real order: several logos, a few
   * retries each, comfortably inside one working session.
   */
  artwork_upload: {
    routeClass: "PUBLIC_EXTERNAL_COST",
    session: { capacity: 10, refillPerMinute: 10 },
    network: { capacity: 30, refillPerMinute: 30 },
    durable: true,
    message: "Too many uploads at once. Wait a moment and try again.",
  },

  /** Verification of an already-minted object: a HEAD plus a 16-byte ranged GET. */
  artwork_complete: {
    routeClass: "PUBLIC_LOW_COST",
    session: { capacity: 30, refillPerMinute: 60 },
    network: { capacity: 90, refillPerMinute: 180 },
    durable: false,
    message: "Too many uploads at once. Wait a moment and try again.",
  },

  /**
   * AI chat — the only route where a single request bills a model provider.
   * Unchanged from Session 05 (6/min per session, 20/min per network): those
   * numbers were chosen for this exact cost profile and remain right. What is
   * new is the durable layer, so the per-instance bypass no longer multiplies
   * the allowance by the instance count.
   */
  ai_chat: {
    routeClass: "PUBLIC_EXTERNAL_COST",
    session: { capacity: 6, refillPerMinute: 6 },
    network: { capacity: 20, refillPerMinute: 20 },
    durable: true,
    message: "You're sending messages very quickly — give it a few seconds and try again.",
  },

  /**
   * Admin writes are already gated by credentials, same-origin and a JSON
   * content type. This bounds a runaway admin script (a reconciliation button
   * held down), not a stranger — so it is per network only: the admin has no
   * first-party storefront session.
   */
  admin_write: {
    routeClass: "AUTHENTICATED",
    session: null,
    network: { capacity: 30, refillPerMinute: 60 },
    durable: false,
    message: TOO_FAST,
  },
};

export function policyFor(route: RateLimitRoute): RateLimitPolicy {
  return RATE_LIMIT_POLICIES[route];
}

import { NextResponse } from "next/server";
import { getCommerce } from "@/lib/commerce";
import { getCatalogProductById } from "@/lib/commerce/catalog";
import { checkoutRequestSchema, type CheckoutRequestLine } from "@/lib/validation/checkout";
import { calculatePrice } from "@/modules/pricing";
import { formatDimensions } from "@/lib/format";
import { getAiAssistanceForSession } from "@/lib/data/ai-assistance";
import { isArtworkUsableForSession, linkArtworkToOrderLine } from "@/lib/data/artwork-service";
import { upsertActiveConfiguration } from "@/lib/data/configuration-service";
import { markConversationOutcomeForSession } from "@/lib/data/conversation-service";
import { applyNeedProfileUpdate } from "@/lib/data/customer-need-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { createOrder, setOrderCheckoutRef } from "@/lib/data/order-service";
import { sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { markConverted, type SessionRow } from "@/lib/data/session-service";
import { CommerceConfigurationError } from "@/lib/commerce/config";
import { ShopifyCheckoutError } from "@/lib/commerce/shopify";
import { correlationIdFrom, withCorrelationHeader } from "@/lib/observability/correlation";
import { captureException } from "@/lib/observability/error-tracking";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit/http";
import type { Cart, CartLine, Product } from "@/types/commerce";

/**
 * Server-side checkout re-quote — the browser PROPOSES, this route DISPOSES.
 *
 * Every cart line is validated against the live catalog and re-priced with
 * the deterministic pricing engine before any checkout/order is created.
 * Client-sent prices are never trusted: they are only compared against the
 * server quote to detect drift (stale tab, tampering, catalog change) and
 * answered with 409 REPRICED so the user re-confirms the corrected total.
 *
 * Margin telemetry runs server-side only — cost and margin figures are
 * business-internal and are NEVER included in any response.
 *
 * ABUSE (Production Launch Session 03 §17): with Shopify live, each accepted
 * request creates a DRAFT ORDER in the owner's admin — a record a human may
 * have to clean up, against an API with its own quota. So checkout is rate
 * limited per session and per keyed network identity. The limit is per
 * CHECKOUT, not per line: a B2B buyer ordering six configurations still
 * sends one request, and legitimate multi-line purchasing is untouched.
 *
 * CORRELATION (§35): one id is minted here and travels through the Shopify
 * provider call, the order row and the log line, then returns to the browser
 * in `x-request-id` so a customer can quote it to support.
 */

export const runtime = "nodejs";

type LineError = { lineId: string; reason: string };

type ServerLine = {
  line: CheckoutRequestLine;
  product: Product;
  unitPriceCents: number;
  totalCents: number;
  title: string;
  optionSummary: string;
};

function validateAndPrice(line: CheckoutRequestLine, product: Product): { ok: true; server: ServerLine } | { ok: false; reason: string } {
  const { config } = line;
  const size = product.sizes.find((s) => s.id === config.sizeId);
  if (!size) return { ok: false, reason: `Unknown size "${config.sizeId}"` };
  const material = product.materials.find((m) => m.id === config.materialId);
  if (!material) return { ok: false, reason: `Unknown material "${config.materialId}"` };
  const color = product.colors.find((c) => c.id === config.colorId);
  if (!color) return { ok: false, reason: `Unknown color "${config.colorId}"` };
  const print = product.printOptions.find((p) => p.id === config.printOptionId);
  if (!print) return { ok: false, reason: `Unknown print option "${config.printOptionId}"` };
  if (print.requiresArtwork && !config.artwork) {
    return { ok: false, reason: `"${print.label}" requires artwork — upload a logo or choose "No logo"` };
  }
  // A durable artwork id is required for anything printed (Session 02 §28).
  // A cart saved before durable storage carried only a dead `blob:` URL,
  // which would reach the factory as an un-openable link.
  if (print.requiresArtwork && config.artwork && !config.artwork.artworkId) {
    return {
      ok: false,
      reason: `Please re-upload your logo for "${print.label}" — the earlier file is no longer available`,
    };
  }

  const calc = calculatePrice(product, config);
  if (!calc.ok) {
    return {
      ok: false,
      reason:
        calc.reason === "requires_custom_quote"
          ? "This configuration needs a custom quote — use Request Custom Pricing"
          : "This configuration cannot be priced",
    };
  }

  // Server-only margin telemetry. Never returned to the client.
  if (calc.costStatus === "unconfigured") {
    console.log(
      `[checkout] margins unavailable for ${product.id} (cost model not configured; ` +
        "price-affecting agent actions fail closed — see config/costs.ts)",
    );
  } else if (calc.minimumAllowedPriceCents !== null && calc.totalPriceCents < calc.minimumAllowedPriceCents) {
    // Engine catalog price below the configured margin floor is an OWNER
    // misconfiguration (tiers vs costs), not a customer error — checkout
    // proceeds at the published price, loudly flagged for correction.
    console.warn(
      `[checkout] PUBLISHED PRICE BELOW MARGIN FLOOR for ${product.id}: total ${calc.totalPriceCents}¢ < floor ${calc.minimumAllowedPriceCents}¢ — review pricing tiers vs config/costs.ts`,
    );
  }

  const optionSummary = [`${size.label} (${formatDimensions(size.dimensions)})`, color.label, print.label]
    .filter(Boolean)
    .join(" · ");

  return {
    ok: true,
    server: {
      line,
      product,
      unitPriceCents: calc.unitPriceCents,
      totalCents: calc.totalPriceCents,
      title: product.title,
      optionSummary,
    },
  };
}

export async function POST(req: Request) {
  const correlationId = correlationIdFrom(req);

  const networkLimit = await enforceRateLimit({ route: "checkout", req, scopes: ["network"] });
  if (!networkLimit.allowed) return withCorrelationHeader(rateLimitedResponse(networkLimit), correlationId);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST", error: "Malformed JSON" }, { status: 400 });
  }

  const parsed = checkoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "INVALID", error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { lines, attribution } = parsed.data;
  const errors: LineError[] = [];
  const serverLines: ServerLine[] = [];

  for (const line of lines) {
    const product = await getCatalogProductById(line.config.productId);
    if (!product) {
      errors.push({ lineId: line.lineId, reason: `Unknown product "${line.config.productId}"` });
      continue;
    }
    const result = validateAndPrice(line, product);
    if (!result.ok) errors.push({ lineId: line.lineId, reason: result.reason });
    else serverLines.push(result.server);
  }

  if (errors.length) {
    return NextResponse.json({ ok: false, code: "INVALID", error: "Cart validation failed", errors }, { status: 422 });
  }

  const currencies = new Set(serverLines.map((s) => s.product.currency));
  if (currencies.size > 1) {
    return NextResponse.json(
      { ok: false, code: "INVALID", error: "Cart mixes currencies — order each currency separately" },
      { status: 422 },
    );
  }

  // Price drift: answer with the authoritative quote; the client updates
  // its cart and the user re-confirms before any checkout is created.
  const repriced = serverLines.filter(
    (s) => s.unitPriceCents !== s.line.proposedUnitPriceCents || s.totalCents !== s.line.proposedTotalCents,
  );
  if (repriced.length) {
    return NextResponse.json(
      {
        ok: false,
        code: "REPRICED",
        error: "Prices were updated to current values",
        lines: serverLines.map((s) => ({
          lineId: s.line.lineId,
          quantity: s.line.config.quantity,
          unitPriceCents: s.unitPriceCents,
          totalCents: s.totalCents,
        })),
      },
      { status: 409 },
    );
  }

  const cart: Cart = {
    currency: serverLines[0].product.currency,
    lines: serverLines.map<CartLine>((s) => ({
      lineId: s.line.lineId,
      config: s.line.config,
      unitPriceCents: s.unitPriceCents,
      totalCents: s.totalCents,
      title: s.title,
      optionSummary: s.optionSummary,
    })),
  };

  // Session identity is resolved BEFORE the provider call: artwork ownership
  // must be verified before a checkout exists, and Shopify needs the session
  // as its correlation reference.
  const sessionCtx = await sessionFromRequest(req);

  if (sessionCtx) {
    const sessionLimit = await enforceRateLimit({
      route: "checkout",
      req,
      sessionId: sessionCtx.session.id,
      scopes: ["session"],
    });
    if (!sessionLimit.allowed) return withCorrelationHeader(rateLimitedResponse(sessionLimit), correlationId);
  }

  // Artwork must be real, verified, and THIS session's (Session 02 §28) —
  // an id copied from elsewhere must not put someone else's logo on a bag.
  if (sessionCtx) {
    const artworkErrors: LineError[] = [];
    for (const s of serverLines) {
      const artworkId = s.line.config.artwork?.artworkId;
      if (!artworkId) continue;
      const usable = await isArtworkUsableForSession(artworkId, sessionCtx.session.id).catch((err) => {
        console.error("[checkout] artwork verification failed", err);
        return false;
      });
      if (!usable) {
        artworkErrors.push({
          lineId: s.line.lineId,
          reason: "We couldn't find that uploaded logo — please upload it again",
        });
      }
    }
    if (artworkErrors.length) {
      return NextResponse.json(
        { ok: false, code: "INVALID", error: "Cart validation failed", errors: artworkErrors },
        { status: 422 },
      );
    }
  }

  try {
    const commerce = getCommerce();

    if (commerce.name === "mock") {
      const result = await commerce.createCheckout(cart, attribution, {
        sessionId: sessionCtx?.session.id ?? null,
      });
      if (result.kind !== "mock") throw new Error("mock provider returned a non-mock checkout result");
      const mockOrderId = sessionCtx
        ? await persistMockOrder(sessionCtx.session, serverLines, cart, attribution, result.orderId)
        : null;
      // The BagDirect order id is what the confirmation surface asks the
      // server about (§4). The browser no longer carries a copy of the order
      // itself: a client-held payload is not evidence that anything was paid.
      const res = NextResponse.json({
        ok: true,
        result,
        orderId: mockOrderId,
      });
      if (sessionCtx) setSessionCookies(res, sessionCtx.session);
      return withCorrelationHeader(res, correlationId);
    }

    /* ---------------------------------------------------------------- */
    /* Shopify: the order row is created BEFORE payment — as PENDING     */
    /* ---------------------------------------------------------------- */
    /*
     * The customer has NOT paid yet, and `pending_payment` says exactly
     * that: it is excluded from revenue, from AOV, from profitability and
     * from every conversion metric (modules/business-intelligence/
     * revenue.ts). No purchase event fires, the session is not marked
     * converted, and a browser redirect is never treated as payment (§16).
     *
     * The row exists at this moment for one reason: it is the ONLY place the
     * exact server-priced lines, the immutable configuration snapshots, the
     * artwork links, the attribution and the cost snapshot exist together.
     * Its id travels to Shopify and comes back on the paid order, so
     * reconciliation is a lookup instead of a lossy reconstruction from
     * display attributes.
     *
     * If the customer abandons the Shopify checkout, this row simply stays
     * pending — honest abandoned-checkout data, never revenue.
     */
    if (!sessionCtx) {
      // Without a session there is no artwork ownership check, no
      // attribution and no way to reconcile the paid order. Refusing beats
      // taking money for something we cannot fulfil or trace.
      logError({
        subsystem: "checkout",
        event: "session_unavailable",
        correlationId,
        code: "NO_SESSION",
        detail: "refusing Shopify checkout without a session (cookies blocked, or the database is unreachable)",
      });
      return withCorrelationHeader(
        NextResponse.json(
          { ok: false, code: "PROVIDER_ERROR", error: "Checkout is temporarily unavailable. Nothing was charged." },
          { status: 503 },
        ),
        correlationId,
      );
    }

    const pending = await persistPendingShopifyOrder(sessionCtx.session, serverLines, cart, attribution);

    const result = await commerce.createCheckout(cart, attribution, {
      sessionId: sessionCtx.session.id,
      orderId: pending.orderId,
    });
    if (result.kind !== "redirect") throw new Error("Shopify provider returned a non-redirect checkout result");

    if (result.reference) {
      await setOrderCheckoutRef({ orderId: pending.orderId, checkoutRef: result.reference }).catch((err) =>
        console.error(`[checkout] failed to record checkout ref for ${pending.orderId}`, err),
      );
    }

    // A chat that led to checkout gets its outcome stamped (S06) — non-fatal.
    await markConversationOutcomeForSession(sessionCtx.session.id, "checkout_started").catch((err) =>
      console.error("[checkout] conversation outcome stamp failed", err),
    );
    await recordServerEvent({
      sessionId: sessionCtx.session.id,
      customerId: sessionCtx.session.customerId,
      name: "checkout_started",
      orderId: pending.orderId,
      props: {
        totalCents: cart.lines.reduce((sum, l) => sum + l.totalCents, 0),
        currency: cart.currency,
        lines: cart.lines.length,
      },
    }).catch((err) => console.error("[checkout] checkout_started event failed", err));

    logInfo({
      subsystem: "checkout",
      event: "checkout_created",
      correlationId,
      orderId: pending.orderId,
      lines: cart.lines.length,
      totalCents: cart.lines.reduce((sum, l) => sum + l.totalCents, 0),
      currency: cart.currency,
    });

    // Only the URL and BAGDIRECT's own order id cross to the browser — never
    // Shopify's draft order id. The order id is what the confirmation surface
    // later asks the server about, and it is session-scoped on read.
    const res = NextResponse.json({
      ok: true,
      result: { kind: "redirect", url: result.url },
      orderId: pending.orderId,
    });
    setSessionCookies(res, sessionCtx.session);
    return withCorrelationHeader(res, correlationId);
  } catch (err) {
    // Commerce MISCONFIGURATION is not a transient provider blip — it means
    // production is running without a way to take money. It is logged as such
    // and still answered with customer-safe copy (never a stack trace or a
    // Shopify API message, §42).
    if (err instanceof CommerceConfigurationError) {
      // Reported as an exception, not merely logged: a production deploy that
      // cannot take money is the single most urgent failure in the system.
      captureException(err, {
        subsystem: "checkout",
        event: "commerce_not_configured",
        correlationId,
        code: "COMMERCE_NOT_CONFIGURED",
      });
      return withCorrelationHeader(
        NextResponse.json(
          { ok: false, code: "PROVIDER_ERROR", error: "Checkout is temporarily unavailable" },
          { status: 503 },
        ),
        correlationId,
      );
    }
    if (err instanceof ShopifyCheckoutError) {
      if (err.code === "UNMAPPED_CONFIGURATION") {
        // EXPECTED business outcome (§37), not an exception: the owner has
        // not mapped this combination yet and the customer is routed to a
        // quote. Loud in the log, absent from the error tracker.
        logWarn({
          subsystem: "checkout",
          event: "unmapped_configuration",
          correlationId,
          code: err.code,
          detail: err.message,
        });
      } else {
        captureException(err, {
          subsystem: "checkout",
          event: "shopify_checkout_failed",
          correlationId,
          code: err.code,
        });
      }
      const customerFacing =
        err.code === "UNMAPPED_CONFIGURATION"
          ? "That exact combination isn't available to order online yet — request a custom quote and we'll set it up."
          : "Checkout is temporarily unavailable. Nothing was charged — try again in a moment.";
      return withCorrelationHeader(
        NextResponse.json(
          { ok: false, code: err.code === "UNMAPPED_CONFIGURATION" ? "UNAVAILABLE_CONFIGURATION" : "PROVIDER_ERROR", error: customerFacing },
          { status: err.code === "UNMAPPED_CONFIGURATION" ? 409 : 502 },
        ),
        correlationId,
      );
    }
    captureException(err, {
      subsystem: "checkout",
      event: "create_checkout_failed",
      correlationId,
      code: "PROVIDER_ERROR",
    });
    return withCorrelationHeader(
      NextResponse.json(
        { ok: false, code: "PROVIDER_ERROR", error: "Checkout is temporarily unavailable" },
        { status: 502 },
      ),
      correlationId,
    );
  }
}

/**
 * Persist the completed mock order as first-party intelligence: Order +
 * OrderLine snapshots, the session's active configuration, the
 * authoritative purchase_completed event, conversion stamp, and an
 * ORDER_DATA need-profile enrichment. Failures log loudly and never break
 * the checkout the customer already completed.
 */
async function persistMockOrder(
  session: SessionRow,
  serverLines: ServerLine[],
  cart: Cart,
  attribution: Record<string, string>,
  providerOrderId: string,
): Promise<string | null> {
  try {
    // AI-assisted attribution (S07): conservative material-assistance check —
    // aiAssisted only when the chat demonstrably touched commerce; the latest
    // sales conversation is linked either way for intelligence. Non-fatal.
    const assistance = await getAiAssistanceForSession(session.id).catch((err) => {
      console.error("[checkout] AI-assistance lookup failed (order proceeds unattributed)", err);
      return { aiAssisted: false, conversationId: null };
    });

    const { order, lines: orderLines } = await createOrder({
      sessionId: session.id,
      customerId: session.customerId ?? undefined,
      businessId: session.businessId ?? undefined,
      conversationId: assistance.conversationId ?? undefined,
      aiAssisted: assistance.aiAssisted,
      provider: "mock",
      providerOrderId,
      currency: cart.currency,
      status: "created",
      attribution,
      lines: serverLines.map((s) => ({
        productId: s.product.id,
        quantity: s.line.config.quantity,
        unitPriceCents: s.unitPriceCents,
        totalCents: s.totalCents,
        title: s.title,
        optionSummary: s.optionSummary,
        config: s.line.config,
        artwork: s.line.config.artwork ?? null,
      })),
    });

    // Artwork → ORDER LINE, explicitly (Session 02 §28). Fulfilment can now
    // answer "which artwork belongs to this line?" without guessing from a
    // filename, an email address or a browser session.
    for (let i = 0; i < serverLines.length; i += 1) {
      const artworkId = serverLines[i].line.config.artwork?.artworkId;
      const orderLine = orderLines[i];
      if (!artworkId || !orderLine) continue;
      await linkArtworkToOrderLine({
        artworkId,
        orderId: order.id,
        orderLineId: orderLine.id,
        customerId: session.customerId,
      }).catch((err) => console.error(`[checkout] artwork ${artworkId} link failed`, err));
    }

    for (const s of serverLines) {
      await upsertActiveConfiguration({
        sessionId: session.id,
        productId: s.product.id,
        config: s.line.config,
        priceSnapshot: { unitPriceCents: s.unitPriceCents, totalCents: s.totalCents, currency: cart.currency },
        source: "checkout",
      });
    }

    await recordServerEvent({
      sessionId: session.id,
      customerId: session.customerId,
      name: "purchase_completed",
      orderId: order.id,
      productId: serverLines[0]?.product.id ?? null,
      props: {
        totalCents: order.totalCents,
        currency: order.currency,
        lines: serverLines.length,
        providerOrderId,
        aiAssisted: assistance.aiAssisted,
      },
    });
    await markConverted(session.id);
    await markConversationOutcomeForSession(session.id, "purchased");

    // What the customer actually ordered is the strongest behavioral signal.
    const first = serverLines[0];
    if (first) {
      const size = first.product.sizes.find((s) => s.id === first.line.config.sizeId);
      await applyNeedProfileUpdate(
        session.id,
        {
          productInterest: first.product.id,
          quantity: first.line.config.quantity,
          materialPreference: first.line.config.materialId,
          colorPreference: first.line.config.colorId,
          printingRequirement: first.line.config.printOptionId,
          ...(first.line.config.artwork ? { logoAvailable: true } : {}),
          ...(size
            ? {
                desiredWidth: size.dimensions.width,
                desiredHeight: size.dimensions.height,
                desiredGusset: size.dimensions.gusset,
              }
            : {}),
        },
        "ORDER_DATA",
        { customerId: session.customerId },
      );
    }
    return order.id;
  } catch (err) {
    console.error(`[checkout] order persistence failed for ${providerOrderId} — commerce unaffected`, err);
    return null;
  }
}

/**
 * Persist the PRE-PAYMENT Shopify order (Production Launch Session 02 §17).
 *
 * Unlike `persistMockOrder`, this fires NO purchase event, marks NO
 * conversion and stamps NO `purchased` outcome — none of that is true yet.
 * It records what the customer is ABOUT to pay for, so the paid order
 * arriving by webhook has something exact to reconcile against.
 *
 * Failure here is FATAL to the checkout, deliberately, and this is the one
 * place in the codebase where "persistence is additive to commerce" does not
 * apply: without this row a paid Shopify order could never be linked to a
 * configuration, an artwork file or a session — the factory would receive
 * money and no printable instructions.
 */
async function persistPendingShopifyOrder(
  session: SessionRow,
  serverLines: ServerLine[],
  cart: Cart,
  attribution: Record<string, string>,
): Promise<{ orderId: string }> {
  const assistance = await getAiAssistanceForSession(session.id).catch((err) => {
    console.error("[checkout] AI-assistance lookup failed (order proceeds unattributed)", err);
    return { aiAssisted: false, conversationId: null };
  });

  const { order, lines } = await createOrder({
    sessionId: session.id,
    customerId: session.customerId ?? undefined,
    businessId: session.businessId ?? undefined,
    conversationId: assistance.conversationId ?? undefined,
    aiAssisted: assistance.aiAssisted,
    provider: "shopify",
    currency: cart.currency,
    status: "pending_payment",
    attribution,
    lines: serverLines.map((s) => ({
      productId: s.product.id,
      quantity: s.line.config.quantity,
      unitPriceCents: s.unitPriceCents,
      totalCents: s.totalCents,
      title: s.title,
      optionSummary: s.optionSummary,
      config: s.line.config,
      artwork: s.line.config.artwork ?? null,
    })),
  });

  // Artwork → order line, before payment: the association must survive even
  // if the webhook is delayed (§28). Non-fatal — the order line already
  // carries the artwork id in its config snapshot.
  for (let i = 0; i < serverLines.length; i += 1) {
    const artworkId = serverLines[i].line.config.artwork?.artworkId;
    const orderLine = lines[i];
    if (!artworkId || !orderLine) continue;
    await linkArtworkToOrderLine({
      artworkId,
      orderId: order.id,
      orderLineId: orderLine.id,
      customerId: session.customerId,
    }).catch((err) => console.error(`[checkout] artwork ${artworkId} link failed`, err));
  }

  for (const s of serverLines) {
    await upsertActiveConfiguration({
      sessionId: session.id,
      productId: s.product.id,
      config: s.line.config,
      priceSnapshot: { unitPriceCents: s.unitPriceCents, totalCents: s.totalCents, currency: cart.currency },
      source: "checkout",
    }).catch((err) => console.error("[checkout] configuration snapshot failed", err));
  }

  return { orderId: order.id };
}

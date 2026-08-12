import { NextResponse } from "next/server";
import { getCommerce } from "@/lib/commerce";
import { getCatalogProductById } from "@/lib/commerce/catalog";
import { checkoutRequestSchema, type CheckoutRequestLine } from "@/lib/validation/checkout";
import { calculatePrice } from "@/modules/pricing";
import { formatDimensions } from "@/lib/format";
import { getAiAssistanceForSession } from "@/lib/data/ai-assistance";
import { upsertActiveConfiguration } from "@/lib/data/configuration-service";
import { markConversationOutcomeForSession } from "@/lib/data/conversation-service";
import { applyNeedProfileUpdate } from "@/lib/data/customer-need-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { createOrder } from "@/lib/data/order-service";
import { sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { markConverted, type SessionRow } from "@/lib/data/session-service";
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

  try {
    const result = await getCommerce().createCheckout(cart, attribution);
    // Session identity + persistence are additive: commerce never fails
    // because the data layer hiccuped (loud logs instead).
    const sessionCtx = await sessionFromRequest(req);

    if (result.kind === "mock") {
      if (sessionCtx) {
        await persistMockOrder(sessionCtx.session, serverLines, cart, attribution, result.orderId);
      }
      // The client also keeps the server-priced payload for the demo
      // confirmation page (sessionStorage) — the DB row is the record.
      const res = NextResponse.json({
        ok: true,
        result,
        order: { cart, attribution, createdAt: new Date().toISOString() },
      });
      if (sessionCtx) setSessionCookies(res, sessionCtx.session);
      return res;
    }

    // Shopify redirect: the order exists only after payment on Shopify's
    // checkout — order rows arrive with order webhooks (future session).
    if (sessionCtx) {
      // A chat that led to checkout gets its outcome stamped (S06) — non-fatal.
      await markConversationOutcomeForSession(sessionCtx.session.id, "checkout_started").catch((err) =>
        console.error("[checkout] conversation outcome stamp failed", err),
      );
    }
    const res = NextResponse.json({ ok: true, result });
    if (sessionCtx) setSessionCookies(res, sessionCtx.session);
    return res;
  } catch (err) {
    console.error("[checkout] provider createCheckout failed", err);
    return NextResponse.json(
      { ok: false, code: "PROVIDER_ERROR", error: "Checkout is temporarily unavailable" },
      { status: 502 },
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
): Promise<void> {
  try {
    // AI-assisted attribution (S07): conservative material-assistance check —
    // aiAssisted only when the chat demonstrably touched commerce; the latest
    // sales conversation is linked either way for intelligence. Non-fatal.
    const assistance = await getAiAssistanceForSession(session.id).catch((err) => {
      console.error("[checkout] AI-assistance lookup failed (order proceeds unattributed)", err);
      return { aiAssisted: false, conversationId: null };
    });

    const { order } = await createOrder({
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
  } catch (err) {
    console.error(`[checkout] order persistence failed for ${providerOrderId} — commerce unaffected`, err);
  }
}

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as cartLinePost } from "@/app/api/cart/line/route";
import { POST as checkoutPost } from "@/app/api/checkout/route";
import { getDb } from "@/db/client";
import { events, orders } from "@/db/schema";
import { PRODUCTS } from "@/config/products";
import { cartLineOptionSummary, prepareCartLineFromConfiguration } from "@/lib/commerce/cart-line";
import { syncConfigurationForSession } from "@/lib/configuration/server";
import { defaultConfiguration } from "@/lib/configuration/validation";
import { getAiAssistanceForSession } from "@/lib/data/ai-assistance";
import {
  getConversation,
  markConversationOutcomeForSession,
  startConversation,
} from "@/lib/data/conversation-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { formatDimensions } from "@/lib/format";
import { makeSession, resetDb, uploadedArtwork } from "./db-helpers";
import type { SessionRow } from "@/lib/data/session-service";

/**
 * Session 07 — AI-path cart-line preparation (server function + route),
 * conversation outcome ranking, and AI-assisted order attribution.
 *
 * The cart stays client-side; these tests pin the server-side guarantees:
 * the line always comes from the AUTHORITATIVE configuration row, engine-
 * priced, with /api/checkout-style reprice + S06-style stale protection,
 * and it is byte-equivalent to what the manual configurator would add.
 */

/**
 * Product #1 — Custom Insulated Takeout Bag.
 * Large: 5,000 → 19¢/bag · 10,000 → 15¢/bag. MOQ 5,000. Its single print
 * option always requires artwork.
 */
const product = PRODUCTS[0];

beforeEach(resetDb);

/** Seed the session's shared configuration (source: configurator, revision 1). */
async function seedConfiguration(
  session: SessionRow,
  overrides: Partial<ReturnType<typeof defaultConfiguration>> = {},
) {
  /* The launch product prints custom artwork on every order, so an
     addable configuration always carries a durable artwork id. Tests that
     want the blocked path pass `artwork: null` explicitly. */
  const seeded =
    "artwork" in overrides ? overrides : { ...overrides, artwork: (await uploadedArtwork(session)).artwork };
  overrides = seeded;
  const config = { ...defaultConfiguration(product), colorId: "black", quantity: 10_000, ...overrides };
  const result = await syncConfigurationForSession({ sessionId: session.id, productId: product.id, config });
  if (result.status !== "applied") throw new Error(`seed failed: ${result.status}`);
  return result.current;
}

async function sessionEvents(sessionId: string) {
  const db = await getDb();
  return db.select().from(events).where(eq(events.sessionId, sessionId));
}

describe("prepareCartLineFromConfiguration", () => {
  it("prepares the authoritative configuration as an engine-priced line, equivalent to a manual add", async () => {
    const session = await makeSession();
    await seedConfiguration(session);

    const result = await prepareCartLineFromConfiguration({
      sessionId: session.id,
      productId: product.id,
      expectedRevision: 1,
      expectedTotalCents: 15 * 10_000,
    });
    expect(result.status).toBe("prepared");
    if (result.status !== "prepared") return;

    // Exactly what the manual configurator's handleAdd would snapshot.
    const size = product.sizes.find((s) => s.id === result.line.config.sizeId)!;
    const manualSummary = [
      `${size.label} (${formatDimensions({ ...size.dimensions, unit: size.unit })})`,
      product.colors.find((c) => c.id === "black")!.label,
      product.printOptions.find((p) => p.id === "full-custom")!.label,
    ]
      .filter(Boolean)
      .join(" · ");
    expect(result.line).toEqual({
      config: expect.objectContaining({
        productId: product.id,
        colorId: "black",
        printOptionId: "full-custom",
        quantity: 10_000,
      }),
      unitPriceCents: 15,
      totalCents: 150_000,
      title: product.title,
      optionSummary: manualSummary,
    });
    expect(cartLineOptionSummary(product, result.line.config)).toBe(manualSummary);
    expect(result.revision).toBe(1);
    expect(result.pricingStatus).toBe("LIVE"); // Product #1 carries confirmed prices
    // No cost/margin/floor data has a path through this result.
    expect(JSON.stringify(result)).not.toMatch(/cost|margin|floor/i);
  });

  it("answers repriced (never a silent add) when the stated total differs from the engine", async () => {
    const session = await makeSession();
    await seedConfiguration(session);
    const result = await prepareCartLineFromConfiguration({
      sessionId: session.id,
      productId: product.id,
      expectedRevision: 1,
      expectedTotalCents: 1, // "the AI saw $0.01" — the server quote wins
    });
    expect(result).toMatchObject({
      status: "repriced",
      expectedTotalCents: 1,
      currentPrice: { unitPriceCents: 15, totalCents: 150_000, currency: "USD" },
      revision: 1,
    });
  });

  it("rejects stale revisions with the current state (a changed configuration is never silently added)", async () => {
    const session = await makeSession();
    await seedConfiguration(session); // revision 1
    await seedConfiguration(session, { quantity: 5000 }); // customer edits → revision 2

    const result = await prepareCartLineFromConfiguration({
      sessionId: session.id,
      productId: product.id,
      expectedRevision: 1,
      expectedTotalCents: 150_000,
    });
    expect(result.status).toBe("stale_configuration");
    if (result.status === "stale_configuration") {
      expect(result.current.revision).toBe(2);
      expect(result.current.config.quantity).toBe(5000);
    }
  });

  it("blocks printed configurations without artwork — same rule as the manual Add to Cart", async () => {
    const session = await makeSession();
    await seedConfiguration(session, { artwork: null });
    const result = await prepareCartLineFromConfiguration({
      sessionId: session.id,
      productId: product.id,
      expectedRevision: 1,
      expectedTotalCents: 15 * 10_000,
    });
    expect(result.status).toBe("artwork_required");
    if (result.status === "artwork_required") expect(result.printLabel).toBe("Custom logo / artwork printing");
  });

  it("routes custom-quote configurations (below MOQ / off-tier quantity) to the quote flow, never the cart", async () => {
    const session = await makeSession();
    await seedConfiguration(session, { quantity: 300 });
    const belowMoq = await prepareCartLineFromConfiguration({
      sessionId: session.id,
      productId: product.id,
      expectedRevision: 1,
      expectedTotalCents: 100,
    });
    expect(belowMoq.status).toBe("custom_quote_required");

    // 12,000 is above the published 10,000 tier: real, orderable by quote,
    // and deliberately unpriced here.
    await seedConfiguration(session, { quantity: 12_000 });
    const offTier = await prepareCartLineFromConfiguration({
      sessionId: session.id,
      productId: product.id,
      expectedRevision: 2,
      expectedTotalCents: 180_000,
    });
    expect(offTier.status).toBe("custom_quote_required");
  });

  it("unknown products come back structured", async () => {
    const session = await makeSession();
    const result = await prepareCartLineFromConfiguration({
      sessionId: session.id,
      productId: "p-imaginary",
      expectedRevision: 0,
      expectedTotalCents: 100,
    });
    expect(result.status).toBe("unknown_product");
  });

  it("a never-configured product resolves to catalog defaults (revision 0) and enforces their rules", async () => {
    const session = await makeSession();
    // Defaults ship custom printing with no artwork — the add is blocked
    // exactly like the manual configurator's disabled button.
    const result = await prepareCartLineFromConfiguration({
      sessionId: session.id,
      productId: product.id,
      expectedRevision: 0,
      expectedTotalCents: 150_000,
    });
    expect(result.status).toBe("artwork_required");
  });
});

describe("POST /api/cart/line (chip taps)", () => {
  function post(body: unknown, session?: SessionRow): Request {
    return new Request("http://localhost/api/cart/line", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(session ? { cookie: `bd_sid=${session.id}; bd_aid=${session.anonymousId}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("prepares a line for the session's current configuration and records the funnel", async () => {
    const session = await makeSession();
    await seedConfiguration(session);
    await startConversation({ sessionId: session.id });

    const res = await cartLinePost(
      post({ productId: product.id, expectedRevision: 1, expectedTotalCents: 150_000 }, session),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.status).toBe("prepared");
    expect(data.line.unitPriceCents).toBe(15);
    expect(data.line.totalCents).toBe(150_000);
    expect(data.line.title).toBe(product.title);
    expect(JSON.stringify(data)).not.toMatch(/cost|margin|floor/i);

    const eventRows = await sessionEvents(session.id);
    const requested = eventRows.find((e) => e.name === "ai_add_to_cart_requested");
    expect(requested?.propsJson).toMatchObject({ via: "chip", outcome: "prepared" });
    // cart_added stamped on the live conversation.
    const { findActiveConversation } = await import("@/lib/data/conversation-service");
    const conversation = await findActiveConversation(session.id, "sales");
    expect(conversation?.outcome).toBe("cart_added");
  });

  it("409 REPRICED with the current engine price when the chip's price drifted", async () => {
    const session = await makeSession();
    await seedConfiguration(session);
    const res = await cartLinePost(
      post({ productId: product.id, expectedRevision: 1, expectedTotalCents: 360_000 }, session),
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("REPRICED");
    expect(data.currentPrice.totalCents).toBe(150_000);
  });

  it("409 STALE_CONFIGURATION when the configuration moved on (cross-session state can never be added)", async () => {
    const sessionA = await makeSession();
    await seedConfiguration(sessionA); // revision 1 belongs to A
    const sessionB = await makeSession();
    const res = await cartLinePost(
      post({ productId: product.id, expectedRevision: 1, expectedTotalCents: 150_000 }, sessionB),
    );
    // Session B is still at defaults (revision 0) — A's revision is meaningless here.
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("STALE_CONFIGURATION");
  });

  it("422 for artwork/custom-quote blocks, 404 for unknown products", async () => {
    const session = await makeSession();
    await seedConfiguration(session, { artwork: null });
    const artwork = await cartLinePost(
      post({ productId: product.id, expectedRevision: 1, expectedTotalCents: 15 * 10_000 }, session),
    );
    expect(artwork.status).toBe(422);
    expect((await artwork.json()).code).toBe("ARTWORK_REQUIRED");

    await seedConfiguration(session, { quantity: 300 });
    const quote = await cartLinePost(
      post({ productId: product.id, expectedRevision: 2, expectedTotalCents: 100 }, session),
    );
    expect(quote.status).toBe(422);
    expect((await quote.json()).code).toBe("CUSTOM_QUOTE_REQUIRED");

    const unknown = await cartLinePost(
      post({ productId: "p-imaginary", expectedRevision: 0, expectedTotalCents: 100 }, session),
    );
    expect(unknown.status).toBe(404);
  });

  it("STRICT body: injected price/config keys are a loud 422, malformed JSON 400, oversized 413", async () => {
    const session = await makeSession();
    await seedConfiguration(session);
    const priceInjection = await cartLinePost(
      post(
        { productId: product.id, expectedRevision: 1, expectedTotalCents: 150_000, unitPriceCents: 1 },
        session,
      ),
    );
    expect(priceInjection.status).toBe(422);
    const configInjection = await cartLinePost(
      post({ productId: product.id, expectedRevision: 1, expectedTotalCents: 150_000, config: { quantity: 1 } }, session),
    );
    expect(configInjection.status).toBe(422);
    expect((await cartLinePost(post("{not json", session))).status).toBe(400);
    expect((await cartLinePost(post({ pad: "x".repeat(5000) }, session))).status).toBe(413);
  });
});

describe("conversation outcome ranking (S07)", () => {
  it("cart_added slots into the funnel and never downgrades deeper stages", async () => {
    const session = await makeSession();
    const conversation = await startConversation({ sessionId: session.id });

    await markConversationOutcomeForSession(session.id, "cart_added");
    expect((await getConversation(conversation.id))?.outcome).toBe("cart_added");

    await markConversationOutcomeForSession(session.id, "checkout_started");
    expect((await getConversation(conversation.id))?.outcome).toBe("checkout_started");

    // A later add-to-cart does not pull the funnel stage back.
    await markConversationOutcomeForSession(session.id, "cart_added");
    expect((await getConversation(conversation.id))?.outcome).toBe("checkout_started");

    await markConversationOutcomeForSession(session.id, "purchased");
    await markConversationOutcomeForSession(session.id, "cart_added");
    expect((await getConversation(conversation.id))?.outcome).toBe("purchased");
  });
});

describe("AI-assisted order attribution (S07)", () => {
  function checkoutRequest(session: SessionRow, artwork: unknown): Request {
    return new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `bd_sid=${session.id}; bd_aid=${session.anonymousId}`,
      },
      body: JSON.stringify({
        lines: [
          {
            lineId: "L1",
            config: {
              productId: product.id,
              sizeId: "l",
              materialId: "insulated",
              colorId: "black",
              printOptionId: "full-custom",
              quantity: 5000,
              artwork,
            },
            proposedUnitPriceCents: 19,
            proposedTotalCents: 19 * 5000,
          },
        ],
        attribution: {},
      }),
    });
  }

  async function orderRow(sessionId: string) {
    const db = await getDb();
    const [row] = await db.select().from(orders).where(eq(orders.sessionId, sessionId)).limit(1);
    return row;
  }

  it("material AI assistance ⇒ aiAssisted true + conversation linked on the order and the purchase event", async () => {
    const session = await makeSession();
    const conversation = await startConversation({ sessionId: session.id });
    await recordServerEvent({
      sessionId: session.id,
      name: "ai_add_to_cart_requested",
      conversationId: conversation.id,
      props: { via: "conversation", outcome: "prepared" },
    });

    const res = await checkoutPost(checkoutRequest(session, (await uploadedArtwork(session)).artwork));
    expect(res.status).toBe(200);
    const order = await orderRow(session.id);
    expect(order?.aiAssisted).toBe(true);
    expect(order?.conversationId).toBe(conversation.id);
    const purchase = (await sessionEvents(session.id)).find((e) => e.name === "purchase_completed");
    expect(purchase?.propsJson).toMatchObject({ aiAssisted: true });
  });

  it("a chat that never touched commerce is NOT material: linked but aiAssisted false", async () => {
    const session = await makeSession();
    const conversation = await startConversation({ sessionId: session.id });
    // ai_chat_started / ai_message_sent alone are not material assistance.
    await recordServerEvent({ sessionId: session.id, name: "ai_chat_started", conversationId: conversation.id });

    const res = await checkoutPost(checkoutRequest(session, (await uploadedArtwork(session)).artwork));
    expect(res.status).toBe(200);
    const order = await orderRow(session.id);
    expect(order?.aiAssisted).toBe(false);
    expect(order?.conversationId).toBe(conversation.id);
  });

  it("no conversation ⇒ aiAssisted false, no conversation link", async () => {
    const session = await makeSession();
    const res = await checkoutPost(checkoutRequest(session, (await uploadedArtwork(session)).artwork));
    expect(res.status).toBe(200);
    const order = await orderRow(session.id);
    expect(order?.aiAssisted).toBe(false);
    expect(order?.conversationId).toBeNull();

    expect(await getAiAssistanceForSession(session.id)).toEqual({ aiAssisted: false, conversationId: null });
  });
});

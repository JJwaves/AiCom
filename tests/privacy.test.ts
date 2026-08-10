import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST as quotePOST } from "@/app/api/quote/route";
import { PRODUCTS } from "@/config/products";
import { getDb } from "@/db/client";
import {
  artworks,
  businesses,
  conversations,
  customerNeedProfiles,
  customers,
  events,
  messages,
  orders,
  productConfigurations,
  quotes,
  sessions,
} from "@/db/schema";
import { appendMessage, startConversation } from "@/lib/data/conversation-service";
import { upsertActiveConfiguration } from "@/lib/data/configuration-service";
import { applyNeedProfileUpdate, getNeedProfile } from "@/lib/data/customer-need-service";
import { recordServerEvent } from "@/lib/data/event-service";
import { createOrder } from "@/lib/data/order-service";
import { deleteCustomerData, deleteSessionData } from "@/lib/data/privacy";
import { recordArtwork } from "@/lib/data/quote-service";
import { resetDb } from "./db-helpers";

/**
 * Session 03.5 hardening: privacy deletion semantics, exercised against the
 * REAL writers (the quote route builds the identified-customer graph the
 * way production does).
 *
 * - deleteSessionData: one session's behavioral trail dies (cascade);
 *   commerce records survive detached and UNREDACTED (identity untouched).
 * - deleteCustomerData: the person dies — identity row, their sessions
 *   (same cascade), cross-session profiles/conversations — and surviving
 *   commerce records are redacted: quote payload PII incl. the raw
 *   artwork filename, artwork fileName/storageUrl/notes.
 */

const product = PRODUCTS[0];

const PII = {
  businessName: "Bangkok Bites",
  contactName: "Nok S.",
  email: "nok@bangkokbites.example",
  phone: "555-0100",
  fileName: "bangkok-bites-nok-logo.png",
};

const config = {
  productId: product.id,
  sizeId: "m",
  materialId: "standard",
  colorId: "white",
  printOptionId: "none" as const,
  quantity: 5000,
  artwork: null,
};

function quoteFormData(overrides: Record<string, string> = {}, artwork?: File): FormData {
  const fd = new FormData();
  const fields: Record<string, string> = {
    businessName: PII.businessName,
    contactName: PII.contactName,
    email: PII.email,
    phone: PII.phone,
    productType: "custom takeout bags",
    dimensions: "",
    quantity: "5,000",
    printing: "1-color logo",
    desiredDelivery: "mid September",
    postalCode: "94103",
    notes: "",
    attribution: JSON.stringify({ first_utm_source: "google" }),
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (artwork) fd.set("artwork", artwork);
  return fd;
}

const quoteRequest = (fd: FormData): Request =>
  new Request("http://localhost/api/quote", { method: "POST", body: fd });

/** Submit a quote through the real route → identified customer graph. Returns the created rows. */
async function submitIdentifiedQuote(overrides: Record<string, string> = {}) {
  const artwork = new File([new Uint8Array(2048)], overrides.fileName ?? PII.fileName, { type: "image/png" });
  const res = await quotePOST(quoteRequest(quoteFormData(overrides, artwork)));
  expect(res.status).toBe(200);
  const db = await getDb();
  const email = (overrides.email ?? PII.email).toLowerCase();
  const [customer] = await db.select().from(customers).where(eq(customers.email, email));
  const [session] = await db.select().from(sessions).where(eq(sessions.customerId, customer.id));
  const [quote] = await db.select().from(quotes).where(eq(quotes.customerId, customer.id));
  const [artworkRow] = await db.select().from(artworks).where(eq(artworks.quoteId, quote.id));
  return { customer, session, quote, artworkRow };
}

/** Attach the remaining behavioral + commerce rows to a session/customer. */
async function enrichGraph(sessionId: string, customerId: string) {
  await recordServerEvent({ sessionId, name: "product_viewed", customerId, productId: product.id });
  const conversation = await startConversation({ sessionId, customerId, agentType: "sales" });
  await appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: `Hi, I'm ${PII.contactName} from ${PII.businessName} — email ${PII.email}.`,
  });
  const configuration = await upsertActiveConfiguration({ sessionId, productId: product.id, config, source: "configurator" });
  const { order } = await createOrder({
    sessionId,
    customerId,
    provider: "mock",
    currency: "USD",
    lines: [
      { productId: product.id, quantity: 5000, unitPriceCents: 42, totalCents: 210_000, title: product.title, config },
    ],
  });
  return { conversation, configuration, order };
}

describe("deleteSessionData — one session's behavioral trail", () => {
  beforeEach(resetDb);

  it("cascades behavioral rows; commerce records survive detached and unredacted", async () => {
    const { customer, session, quote, artworkRow } = await submitIdentifiedQuote();
    const { conversation, order } = await enrichGraph(session.id, customer.id);

    await deleteSessionData(session.id);

    const db = await getDb();
    // Behavioral: gone with the session.
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await db.select().from(conversations).where(eq(conversations.id, conversation.id))).toHaveLength(0);
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(customerNeedProfiles)).toHaveLength(0);
    expect(await db.select().from(productConfigurations)).toHaveLength(0);

    // Commerce: survives, session link nulled, content intact — session
    // deletion erases a browser trail, not the customer identity.
    const [survivingQuote] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
    expect(survivingQuote.sessionId).toBeNull();
    expect(survivingQuote.customerId).toBe(customer.id);
    expect(survivingQuote.payloadJson.email).toBe(PII.email);
    expect(survivingQuote.payloadJson.artworkFileName).toBe(PII.fileName);

    const [survivingArtwork] = await db.select().from(artworks).where(eq(artworks.id, artworkRow.id));
    expect(survivingArtwork.sessionId).toBeNull();
    expect(survivingArtwork.fileName).toBe(PII.fileName);

    const [survivingOrder] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(survivingOrder.sessionId).toBeNull();
    expect(survivingOrder.totalCents).toBe(210_000);

    // The identity row is untouched.
    expect(await db.select().from(customers).where(eq(customers.id, customer.id))).toHaveLength(1);
  });
});

describe("deleteCustomerData — the person", () => {
  beforeEach(resetDb);

  it("deletes identity + sessions + behavioral data; redacts surviving commerce records", async () => {
    const { customer, session, quote, artworkRow } = await submitIdentifiedQuote();
    const { order } = await enrichGraph(session.id, customer.id);
    expect(await getNeedProfile(session.id)).not.toBeNull(); // precondition: profile existed

    await deleteCustomerData(customer.id);

    const db = await getDb();
    // Identity + behavioral trail: gone.
    expect(await db.select().from(customers)).toHaveLength(0);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await db.select().from(conversations)).toHaveLength(0);
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(customerNeedProfiles)).toHaveLength(0);
    expect(await db.select().from(productConfigurations)).toHaveLength(0);

    // Quote survives as an anonymous business record: PII fields redacted
    // (including the raw upload filename), non-identifying fields intact.
    const [redactedQuote] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
    expect(redactedQuote.customerId).toBeNull();
    expect(redactedQuote.sessionId).toBeNull();
    for (const field of ["businessName", "contactName", "email", "phone", "artworkFileName"]) {
      expect(redactedQuote.payloadJson[field]).toBe("[deleted]");
    }
    expect(redactedQuote.payloadJson.productType).toBe("custom takeout bags");
    expect(redactedQuote.payloadJson.quantity).toBe("5,000");
    expect(JSON.stringify(redactedQuote.payloadJson)).not.toContain(PII.email);
    expect(JSON.stringify(redactedQuote.payloadJson)).not.toContain(PII.fileName);

    // Artwork metadata survives anonymized: filename/storage/notes redacted,
    // technical facts (type, size, status, quote link) preserved.
    const [redactedArtwork] = await db.select().from(artworks).where(eq(artworks.id, artworkRow.id));
    expect(redactedArtwork.fileName).toBe("[deleted]");
    expect(redactedArtwork.storageUrl).toBeNull();
    expect(redactedArtwork.notes).toBeNull();
    expect(redactedArtwork.customerId).toBeNull();
    expect(redactedArtwork.fileType).toBe("image/png");
    expect(redactedArtwork.sizeBytes).toBe(2048);
    expect(redactedArtwork.quoteId).toBe(quote.id);

    // Order survives detached with its money/config record intact.
    const [survivingOrder] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(survivingOrder.customerId).toBeNull();
    expect(survivingOrder.sessionId).toBeNull();
    expect(survivingOrder.totalCents).toBe(210_000);

    // Businesses are companies, not people — never deleted here.
    expect(await db.select().from(businesses)).toHaveLength(1);
  });

  it("redacts artwork notes and storageUrl written by the service", async () => {
    const { customer, session, quote } = await submitIdentifiedQuote();
    const extra = await recordArtwork({
      sessionId: session.id,
      customerId: customer.id,
      quoteId: quote.id,
      fileName: "nok-personal-cell-555-0100.pdf",
      fileType: "application/pdf",
      sizeBytes: 4096,
      storageUrl: "https://storage.example/uploads/nok-personal-cell-555-0100.pdf",
      notes: "Call Nok at 555-0100 before printing",
    });

    await deleteCustomerData(customer.id);

    const db = await getDb();
    const [row] = await db.select().from(artworks).where(eq(artworks.id, extra.id));
    expect(row.fileName).toBe("[deleted]");
    expect(row.storageUrl).toBeNull();
    expect(row.notes).toBeNull();
  });

  it("removes cross-session profiles and conversations linked to the customer", async () => {
    const { customer } = await submitIdentifiedQuote();

    // A second browser session that was never linked to the customer, but
    // carries a profile + conversation explicitly attributed to them.
    const db = await getDb();
    await db.insert(sessions).values({ id: "sess_other", anonymousId: "anon_other" });
    await applyNeedProfileUpdate(
      "sess_other",
      { businessName: PII.businessName, shippingPostalCode: "94103" },
      "USER_STATED",
      { customerId: customer.id },
    );
    const conversation = await startConversation({ sessionId: "sess_other", customerId: customer.id });
    await appendMessage({ conversationId: conversation.id, role: "user", content: `${PII.email} here again` });

    await deleteCustomerData(customer.id);

    // The unlinked session row itself survives (it is not provably theirs),
    // but the customer-linked profile/conversation content is gone.
    expect(await db.select().from(sessions).where(eq(sessions.id, "sess_other"))).toHaveLength(1);
    expect(await db.select().from(customerNeedProfiles)).toHaveLength(0);
    expect(await db.select().from(conversations)).toHaveLength(0);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("touches only the target customer's data", async () => {
    const first = await submitIdentifiedQuote();
    const second = await submitIdentifiedQuote({
      businessName: "Marseille Crepes",
      contactName: "Luc B.",
      email: "luc@marseillecrepes.example",
      phone: "555-0199",
      fileName: "marseille-luc-logo.png",
    });

    await deleteCustomerData(first.customer.id);

    const db = await getDb();
    // Second customer's world is untouched.
    expect(await db.select().from(customers).where(eq(customers.id, second.customer.id))).toHaveLength(1);
    expect(await db.select().from(sessions).where(eq(sessions.id, second.session.id))).toHaveLength(1);
    const [secondQuote] = await db.select().from(quotes).where(eq(quotes.id, second.quote.id));
    expect(secondQuote.payloadJson.email).toBe("luc@marseillecrepes.example");
    expect(secondQuote.payloadJson.artworkFileName).toBe("marseille-luc-logo.png");
    const [secondArtwork] = await db.select().from(artworks).where(eq(artworks.id, second.artworkRow.id));
    expect(secondArtwork.fileName).toBe("marseille-luc-logo.png");
    expect(await getNeedProfile(second.session.id)).not.toBeNull();

    // First customer is fully gone.
    expect(await db.select().from(customers).where(eq(customers.id, first.customer.id))).toHaveLength(0);
  });

  it("is a no-op for an unknown customer id", async () => {
    const { customer } = await submitIdentifiedQuote();
    await expect(deleteCustomerData("cust_does_not_exist")).resolves.toBeUndefined();
    const db = await getDb();
    expect(await db.select().from(customers).where(eq(customers.id, customer.id))).toHaveLength(1);
  });
});

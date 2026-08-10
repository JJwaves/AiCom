import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST } from "@/app/api/quote/route";
import { getDb } from "@/db/client";
import { artworks, businesses, customers, quotes, sessions } from "@/db/schema";
import { getNeedProfile } from "@/lib/data/customer-need-service";
import { resetDb } from "./db-helpers";

/** No QUOTE_WEBHOOK_URL in tests → the route's dev fallback logs and persists. */

function quoteFormData(overrides: Record<string, string> = {}, artwork?: File): FormData {
  const fd = new FormData();
  const fields: Record<string, string> = {
    businessName: "Bangkok Bites",
    contactName: "Nok S.",
    email: "nok@bangkokbites.example",
    phone: "555-0100",
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

const makeRequest = (fd: FormData): Request =>
  new Request("http://localhost/api/quote", { method: "POST", body: fd });

describe("quote persistence", () => {
  beforeEach(resetDb);

  it("persists quote + customer + business + artwork + USER_STATED need profile", async () => {
    const artwork = new File([new Uint8Array(2048)], "logo.png", { type: "image/png" });
    const res = await POST(makeRequest(quoteFormData({}, artwork)));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("bd_sid=sess_"))).toBe(true);

    const db = await getDb();
    const [customer] = await db.select().from(customers);
    expect(customer.email).toBe("nok@bangkokbites.example");
    expect(customer.name).toBe("Nok S.");
    const [business] = await db.select().from(businesses);
    expect(business.name).toBe("Bangkok Bites");
    expect(customer.businessId).toBe(business.id);

    const [quote] = await db.select().from(quotes);
    expect(quote.status).toBe("submitted");
    expect(quote.createdBy).toBe("customer");
    expect(quote.customerId).toBe(customer.id);
    expect(quote.businessId).toBe(business.id);
    expect(quote.payloadJson.email).toBe("nok@bangkokbites.example");
    expect(quote.attributionJson).toEqual({ first_utm_source: "google" });

    const [art] = await db.select().from(artworks).where(eq(artworks.quoteId, quote.id));
    expect(art.fileName).toBe("logo.png");
    expect(art.sizeBytes).toBe(2048);
    expect(art.status).toBe("uploaded");

    const [session] = await db.select().from(sessions);
    expect(session.customerId).toBe(customer.id); // quote identified the visitor
    const profile = await getNeedProfile(session.id);
    expect(profile?.businessName).toBe("Bangkok Bites");
    expect(profile?.quantity).toBe(5000); // "5,000" parsed exactly
    expect(profile?.printingRequirement).toBe("1-color logo");
    expect(profile?.logoAvailable).toBe(true);
    expect(profile?.fieldSourcesJson.quantity.source).toBe("USER_STATED");
  });

  it("never guesses vague quantities", async () => {
    const res = await POST(makeRequest(quoteFormData({ quantity: "about 5000" })));
    expect(res.status).toBe(200);
    const db = await getDb();
    const [session] = await db.select().from(sessions);
    const profile = await getNeedProfile(session.id);
    expect(profile?.quantity).toBeNull(); // unknown stays unknown
    expect(profile?.businessName).toBe("Bangkok Bites"); // exact facts still recorded
  });

  it("re-submitting with the same email enriches one customer, not two", async () => {
    await POST(makeRequest(quoteFormData()));
    await POST(makeRequest(quoteFormData({ contactName: "" }))); // invalid → rejected, nothing added
    await POST(makeRequest(quoteFormData({ quantity: "10000" })));

    const db = await getDb();
    expect(await db.select().from(customers)).toHaveLength(1);
    expect(await db.select().from(businesses)).toHaveLength(1);
    expect(await db.select().from(quotes)).toHaveLength(2);
  });
});

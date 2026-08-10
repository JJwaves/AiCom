import { NextResponse } from "next/server";
import { quoteSchema, type QuoteRequest } from "@/lib/validation/quote";
import { validateArtworkFile, ARTWORK_MAX_BYTES } from "@/lib/validation/artwork";
import { applyNeedProfileUpdate, type NeedProfileUpdate } from "@/lib/data/customer-need-service";
import { ensureBusiness, linkCustomerBusiness, upsertCustomerByEmail } from "@/lib/data/customer-service";
import { createQuote, recordArtwork } from "@/lib/data/quote-service";
import { sessionFromRequest, setSessionCookies } from "@/lib/data/request-session";
import { linkCustomer, type SessionRow } from "@/lib/data/session-service";

/**
 * Custom-quote intake.
 *
 * Server-side re-validation of everything the client sent (never trust the
 * browser). Delivery is abstracted: with no email provider configured the
 * request is logged so development flows work end-to-end; production wires
 * QUOTE_WEBHOOK_URL (e.g. a Zapier/Make hook, helpdesk, or email service).
 *
 * Artwork files are size/type-checked but NOT persisted here — object
 * storage is a launch task (see BUSINESS_CONFIG_TODO.md).
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const raw: Record<string, string> = {};
  for (const key of [
    "businessName",
    "contactName",
    "email",
    "phone",
    "productType",
    "dimensions",
    "quantity",
    "printing",
    "desiredDelivery",
    "postalCode",
    "notes",
  ]) {
    const v = fd.get(key);
    raw[key] = typeof v === "string" ? v : "";
  }

  const parsed = quoteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  const file = fd.get("artwork");
  if (file instanceof File && file.size > 0) {
    if (file.size > ARTWORK_MAX_BYTES) {
      return NextResponse.json({ error: "Artwork too large" }, { status: 413 });
    }
    const check = validateArtworkFile({ name: file.name, type: file.type, size: file.size });
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 422 });
    }
  }

  // Attribution is a JSON blob of flat strings; cap its size defensively.
  const attributionRaw = fd.get("attribution");
  let attribution: Record<string, string> = {};
  if (typeof attributionRaw === "string" && attributionRaw.length < 8192) {
    try {
      attribution = JSON.parse(attributionRaw);
    } catch {
      /* ignore malformed attribution */
    }
  }

  const payload = {
    ...parsed.data,
    artworkFileName: file instanceof File && file.size > 0 ? file.name : null,
    attribution,
    receivedAt: new Date().toISOString(),
  };

  const webhook = process.env.QUOTE_WEBHOOK_URL;
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch (err) {
      console.error("[quote] webhook delivery failed", err);
      return NextResponse.json({ error: "Delivery failed" }, { status: 502 });
    }
  } else {
    // Development fallback — keeps the flow testable before a provider exists.
    console.log("[quote] request received (no QUOTE_WEBHOOK_URL configured):", JSON.stringify(payload, null, 2));
  }

  // First-party persistence (additive; delivery above already succeeded —
  // a data-layer failure logs loudly and never turns into a customer error).
  const sessionCtx = await sessionFromRequest(req);
  if (sessionCtx) {
    await persistQuote(sessionCtx.session, parsed.data, payload, attribution, file instanceof File && file.size > 0 ? file : null);
  }

  const res = NextResponse.json({ ok: true });
  if (sessionCtx) setSessionCookies(res, sessionCtx.session);
  return res;
}

/** "5,000" / " 5000 " → 5000; anything non-numeric (e.g. "a few thousand") stays unknown — never guessed. */
function parseExactQuantity(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) && n > 0 && n <= 100_000_000 ? n : null;
}

/**
 * Persist the submitted quote as first-party records: Customer + Business
 * identity, the Quote row (full validated payload), artwork metadata, and a
 * USER_STATED CustomerNeedProfile enrichment — the customer told us these
 * facts in their own words.
 */
async function persistQuote(
  session: SessionRow,
  data: QuoteRequest,
  payload: Record<string, unknown>,
  attribution: Record<string, string>,
  artworkFile: File | null,
): Promise<void> {
  try {
    const customer = await upsertCustomerByEmail({
      email: data.email,
      name: data.contactName,
      phone: data.phone || undefined,
    });
    const business = await ensureBusiness({ name: data.businessName });
    await linkCustomerBusiness(customer.id, business.id);
    await linkCustomer(session.id, customer.id, business.id);

    const quote = await createQuote({
      sessionId: session.id,
      customerId: customer.id,
      businessId: business.id,
      status: "submitted",
      createdBy: "customer",
      payload,
      attribution,
    });

    if (artworkFile) {
      await recordArtwork({
        sessionId: session.id,
        customerId: customer.id,
        quoteId: quote.id,
        fileName: artworkFile.name,
        fileType: artworkFile.type || "application/octet-stream",
        sizeBytes: artworkFile.size,
      });
    }

    const quantity = parseExactQuantity(data.quantity);
    const update: NeedProfileUpdate = {
      businessName: data.businessName,
      productInterest: data.productType,
      ...(quantity !== null ? { quantity } : {}),
      ...(data.printing ? { printingRequirement: data.printing } : {}),
      ...(data.postalCode ? { shippingPostalCode: data.postalCode } : {}),
      ...(data.desiredDelivery ? { desiredDeliveryDate: data.desiredDelivery } : {}),
      ...(artworkFile ? { logoAvailable: true } : {}),
    };
    await applyNeedProfileUpdate(session.id, update, "USER_STATED", {
      customerId: customer.id,
      businessId: business.id,
    });
  } catch (err) {
    console.error("[quote] persistence failed — quote delivery unaffected", err);
  }
}

import { NextResponse } from "next/server";
import { quoteSchema } from "@/lib/validation/quote";
import { validateArtworkFile, ARTWORK_MAX_BYTES } from "@/lib/validation/artwork";

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

  return NextResponse.json({ ok: true });
}

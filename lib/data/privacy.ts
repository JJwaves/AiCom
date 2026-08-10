import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { artworks, conversations, customerNeedProfiles, customers, quotes, sessions } from "@/db/schema";

/**
 * Privacy / deletion preparation (no portal yet — capability only).
 *
 * Deletion semantics (Session 03, hardened in 03.5 — technical
 * anonymization consistency, not legal policy):
 *
 * - `deleteSessionData(sessionId)` erases ONE browser session's behavioral
 *   trail. The session row's deletion CASCADES events, conversations + raw
 *   messages, the need profile, configurations, and experiment assignments.
 *   Commerce records (orders, quotes, artworks) survive with their session
 *   link nulled and are NOT redacted — they belong to the customer
 *   identity, and erasing that identity is the customer-level operation.
 *
 * - `deleteCustomerData(customerId)` erases the PERSON. It deletes the
 *   identity row AND the customer's behavioral data (their sessions, with
 *   the same cascade as above, plus any need profiles / conversations
 *   linked to the customer from other sessions — raw transcripts and
 *   profile fields hold the same PII the redaction targets elsewhere).
 *   Commerce records survive detached as business records ("an order/quote
 *   of this size happened") with embedded PII redacted: quote payload
 *   contact fields AND the raw artwork filename, artwork fileName /
 *   storageUrl / notes. Business rows are companies, not people — they are
 *   never deleted here.
 *
 * - Event props are bounded scalar maps with no PII by policy; event rows
 *   on the customer's sessions die with those sessions, and any stragglers
 *   elsewhere lose their customer link via FK set-null.
 */

const REDACTED = "[deleted]";
/** Quote payloadJson keys that carry PII — includes the raw upload filename. */
const QUOTE_PII_FIELDS = ["businessName", "contactName", "email", "phone", "notes", "artworkFileName"] as const;

/** Erase one browser session and everything behavioral that hangs off it. */
export async function deleteSessionData(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Delete a customer identity + their behavioral data; redact PII in surviving commerce records. */
export async function deleteCustomerData(customerId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    // 1. Behavioral trail: the customer's sessions go the way of
    //    deleteSessionData — cascades events, conversations + messages,
    //    need profiles, configurations, experiment assignments.
    await tx.delete(sessions).where(eq(sessions.customerId, customerId));

    // 2. Behavioral rows linked to the customer from sessions that were
    //    never linked to them (e.g. a profile written with an explicit
    //    customerId on a session owned by someone else) hold the same PII —
    //    delete them directly. Messages cascade with their conversation.
    await tx.delete(customerNeedProfiles).where(eq(customerNeedProfiles.customerId, customerId));
    await tx.delete(conversations).where(eq(conversations.customerId, customerId));

    // 3. Commerce records survive detached — redact embedded PII.
    const customerQuotes = await tx.select().from(quotes).where(eq(quotes.customerId, customerId));
    for (const quote of customerQuotes) {
      const payload = { ...quote.payloadJson };
      for (const field of QUOTE_PII_FIELDS) {
        // Redact only real values — null/empty fields carry nothing.
        if (field in payload && payload[field]) payload[field] = REDACTED;
      }
      await tx.update(quotes).set({ payloadJson: payload, updatedAt: new Date() }).where(eq(quotes.id, quote.id));
    }

    // Artwork metadata: the row remains ("an artwork existed for this
    // order/quote") but the raw filename, the storage location that embeds
    // it, and free-text notes are identifying — redact, keep type/size.
    await tx
      .update(artworks)
      .set({ fileName: REDACTED, storageUrl: null, notes: null, updatedAt: new Date() })
      .where(eq(artworks.customerId, customerId));

    // 4. Identity row last — remaining FKs (orders, quotes, artworks,
    //    stray events) null their customer link as the row goes.
    await tx.delete(customers).where(eq(customers.id, customerId));
  });
}

import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { businesses, customers } from "@/db/schema";
import { newId } from "./id";

/**
 * Lightweight first-party customer/business records.
 *
 * Shopify remains the commerce system of record for customer accounts —
 * these rows exist to connect sessions, conversations, quotes, and orders
 * to one identity (shopifyCustomerId links across). Anonymous visitors get
 * NO customer row; one is created only when they identify themselves
 * (today: the quote form; later: checkout/webhooks/chat).
 */

export const customerInputSchema = z.object({
  email: z.email().max(320),
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  shopifyCustomerId: z.string().trim().max(64).optional(),
});

export type CustomerRow = typeof customers.$inferSelect;
export type BusinessRow = typeof businesses.$inferSelect;

/** Insert-or-enrich by email. Existing non-null fields are kept (no clobbering with weaker data). */
export async function upsertCustomerByEmail(input: z.input<typeof customerInputSchema>): Promise<CustomerRow> {
  const parsed = customerInputSchema.parse(input);
  const email = parsed.email.toLowerCase();
  const db = await getDb();

  const [existing] = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
  if (existing) {
    const [updated] = await db
      .update(customers)
      .set({
        name: existing.name ?? parsed.name ?? null,
        phone: existing.phone ?? parsed.phone ?? null,
        shopifyCustomerId: existing.shopifyCustomerId ?? parsed.shopifyCustomerId ?? null,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(customers)
    .values({
      id: newId("cust"),
      email,
      name: parsed.name ?? null,
      phone: parsed.phone ?? null,
      shopifyCustomerId: parsed.shopifyCustomerId ?? null,
    })
    .returning();
  return created;
}

export async function getCustomer(id: string): Promise<CustomerRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return row ?? null;
}

export const businessInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  businessType: z.string().trim().max(100).optional(),
  industry: z.string().trim().max(100).optional(),
  website: z.string().trim().max(500).optional(),
  city: z.string().trim().max(100).optional(),
  stateProvince: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
});

/** Find-or-create by exact name (naive MVP dedup — B2B CRM matching is deliberately out of scope). */
export async function ensureBusiness(input: z.input<typeof businessInputSchema>): Promise<BusinessRow> {
  const parsed = businessInputSchema.parse(input);
  const db = await getDb();
  const [existing] = await db.select().from(businesses).where(eq(businesses.name, parsed.name)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(businesses)
    .values({ id: newId("biz"), ...parsed })
    .returning();
  return created;
}

/** Link a customer to a business (first link wins; no silent re-assignment). */
export async function linkCustomerBusiness(customerId: string, businessId: string): Promise<void> {
  const db = await getDb();
  const [row] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!row || row.businessId) return;
  await db.update(customers).set({ businessId, updatedAt: new Date() }).where(eq(customers.id, customerId));
}

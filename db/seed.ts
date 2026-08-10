/**
 * Development seed — DEMO DATA ONLY (`npm run db:seed`).
 *
 * Every row is loudly marked as demo data (names, [DEMO] prefixes,
 * props.demo=true) so nothing here can ever read as real business
 * intelligence. Deliberately NOT seeded: orders, insights, opportunities,
 * decisions — fake commerce/intelligence records are prohibited
 * (CLAUDE.md: never invent customer insights or financial data).
 *
 * Refuses to run against an external database (DATABASE_URL) unless
 * --force is passed.
 */
import { getDb } from "./client";
import {
  conversations,
  customerNeedProfiles,
  customers,
  events,
  messages,
  sessions,
} from "./schema";
import { newId } from "@/lib/data/id";

async function seed() {
  if (process.env.DATABASE_URL && !process.argv.includes("--force")) {
    console.error("[seed] DATABASE_URL is set — refusing to seed a non-embedded database (pass --force to override).");
    process.exit(1);
  }

  const db = await getDb();
  const now = new Date();

  const sessionId = newId("sess");
  const customerId = newId("cust");

  await db.insert(customers).values({
    id: customerId,
    email: "demo-restaurant@example.invalid",
    name: "DEMO DEVELOPMENT DATA — not a real customer",
  });

  await db.insert(sessions).values({
    id: sessionId,
    anonymousId: newId("anon"),
    customerId,
    userAgent: "DEMO_SEED",
    firstTouchJson: {
      params: { utm_source: "demo-seed" },
      landing_page: "/restaurant-takeout-bags",
      referrer: "",
      ts: now.toISOString(),
    },
    lastTouchJson: {
      params: { utm_source: "demo-seed" },
      landing_page: "/restaurant-takeout-bags",
      referrer: "",
      ts: now.toISOString(),
    },
  });

  const demoEvents = ["session_started", "page_view", "product_viewed", "configurator_started"] as const;
  await db.insert(events).values(
    demoEvents.map((name, i) => ({
      id: newId("evt"),
      sessionId,
      name,
      page: "/products/custom-non-woven-takeout-bags",
      propsJson: { demo: true },
      clientEventId: newId("evt"),
      occurredAt: new Date(now.getTime() + i * 1000),
    })),
  );

  const conversationId = newId("conv");
  await db.insert(conversations).values({
    id: conversationId,
    sessionId,
    customerId,
    agentType: "sales",
    status: "ended",
    outcome: "abandoned",
    summaryJson: { demo: true, note: "DEMO seed conversation — no AI was involved" },
    endedAt: now,
  });
  await db.insert(messages).values([
    {
      id: newId("msg"),
      conversationId,
      role: "user",
      content: "[DEMO] I run a restaurant and need takeout bags.",
    },
    {
      id: newId("msg"),
      conversationId,
      role: "assistant",
      content: "[DEMO] Placeholder reply seeded for development — no model generated this.",
    },
  ]);

  await db.insert(customerNeedProfiles).values({
    id: newId("cnp"),
    sessionId,
    customerId,
    businessType: "restaurant",
    businessName: "DEMO DEVELOPMENT DATA",
    fieldSourcesJson: {
      businessType: { source: "USER_STATED", updatedAt: now.toISOString() },
      businessName: { source: "USER_STATED", updatedAt: now.toISOString() },
    },
  });

  console.log(`[seed] DEMO data written: session ${sessionId}, conversation ${conversationId}.`);
  console.log("[seed] Reminder: all rows are marked DEMO and must never appear as production intelligence.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});

import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events } from "@/db/schema";
import { eventInputSchema, recordEvents, recordServerEvent } from "@/lib/data/event-service";
import { newId } from "@/lib/data/id";
import { makeSession, resetDb } from "./db-helpers";

const validEvent = (overrides: Record<string, unknown> = {}) => ({
  name: "product_viewed" as const,
  clientEventId: newId("evt"),
  occurredAt: new Date().toISOString(),
  page: "/products/custom-insulated-takeout-bags",
  productId: "p-1",
  props: { value: 210, currency: "USD" },
  ...overrides,
});

describe("first-party event validation + persistence", () => {
  beforeEach(resetDb);

  it("stores a validated batch", async () => {
    const session = await makeSession();
    const stored = await recordEvents(session.id, [
      eventInputSchema.parse(validEvent()),
      eventInputSchema.parse(validEvent({ name: "price_viewed" })),
    ]);
    expect(stored).toBe(2);
    const db = await getDb();
    const rows = await db.select().from(events).where(eq(events.sessionId, session.id));
    // + the session_started row written at session creation
    expect(rows).toHaveLength(3);
  });

  it("dedups by clientEventId (beacon retries insert once)", async () => {
    const session = await makeSession();
    const event = eventInputSchema.parse(validEvent());
    expect(await recordEvents(session.id, [event])).toBe(1);
    expect(await recordEvents(session.id, [event])).toBe(0);
  });

  it("rejects names outside the platform taxonomy", () => {
    expect(eventInputSchema.safeParse(validEvent({ name: "view_item" })).success).toBe(false); // GA4 name ≠ platform name
    expect(eventInputSchema.safeParse(validEvent({ name: "drop_table" })).success).toBe(false);
  });

  it("rejects malformed ids, timestamps, and unbounded props", () => {
    expect(eventInputSchema.safeParse(validEvent({ clientEventId: "custom-id" })).success).toBe(false);
    expect(eventInputSchema.safeParse(validEvent({ occurredAt: "yesterday" })).success).toBe(false);
    expect(eventInputSchema.safeParse(validEvent({ props: { nested: { deep: true } } })).success).toBe(false);
    expect(eventInputSchema.safeParse(validEvent({ props: { long: "x".repeat(501) } })).success).toBe(false);
    const tooMany = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, i]));
    expect(eventInputSchema.safeParse(validEvent({ props: tooMany })).success).toBe(false);
  });

  it("writes server events with entity links", async () => {
    const session = await makeSession();
    await recordServerEvent({
      sessionId: session.id,
      name: "purchase_completed",
      props: { totalCents: 210000, currency: "USD" },
    });
    const db = await getDb();
    const [row] = await db.select().from(events).where(eq(events.name, "purchase_completed"));
    expect(row.sessionId).toBe(session.id);
    expect(row.propsJson).toEqual({ totalCents: 210000, currency: "USD" });
  });
});

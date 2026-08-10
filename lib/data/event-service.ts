import { z } from "zod";
import { getDb } from "@/db/client";
import { events } from "@/db/schema";
import { newId } from "./id";

/**
 * First-party event persistence — the platform's own behavioral truth
 * (third-party tags receive copies; this store is authoritative).
 *
 * Validation is strict because /api/events is an unauthenticated public
 * endpoint: names must belong to the platform taxonomy, props are bounded
 * scalar maps (no nesting, no blobs, no PII by policy — enforce size, review
 * content at call sites).
 */

/** Platform event taxonomy (docs/DATABASE_SCHEMA.md + MASTER_PROMPT §7). */
export const PLATFORM_EVENT_NAMES = [
  "session_started",
  "page_view",
  "product_viewed",
  "configurator_started",
  "configurator_updated",
  "quantity_selected",
  "artwork_uploaded",
  "price_viewed",
  "shipping_estimate_requested",
  "add_to_cart",
  "checkout_started",
  "purchase_completed",
  "quote_started",
  "quote_submitted",
  "ai_chat_started",
  "ai_message_sent",
  "ai_product_recommended",
  "ai_configuration_updated",
  "human_handoff_requested",
  "experiment_exposed",
  "reorder_started",
] as const;

export type PlatformEventName = (typeof PLATFORM_EVENT_NAMES)[number];

const propsSchema = z
  .record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
  .refine((p) => Object.keys(p).length <= 30, "Too many event properties");

export const eventInputSchema = z.object({
  name: z.enum(PLATFORM_EVENT_NAMES),
  clientEventId: z.string().regex(/^evt_[0-9a-f]{32}$/),
  occurredAt: z.iso.datetime(),
  page: z.string().max(2048).optional(),
  productId: z.string().max(100).optional(),
  props: propsSchema.default({}),
});

export type EventInput = z.infer<typeof eventInputSchema>;

/**
 * Persist a batch of validated client events for a session. Duplicate
 * clientEventIds (beacon retries) are silently dropped.
 */
export async function recordEvents(
  sessionId: string,
  inputs: EventInput[],
  ctx: { customerId?: string | null } = {},
): Promise<number> {
  if (inputs.length === 0) return 0;
  const db = await getDb();
  const rows = await db
    .insert(events)
    .values(
      inputs.map((e) => ({
        id: newId("evt"),
        sessionId,
        customerId: ctx.customerId ?? null,
        name: e.name,
        page: e.page ?? null,
        productId: e.productId ?? null,
        propsJson: e.props,
        clientEventId: e.clientEventId,
        occurredAt: new Date(e.occurredAt),
      })),
    )
    .onConflictDoNothing({ target: events.clientEventId })
    .returning({ id: events.id });
  return rows.length;
}

/** Server-emitted platform event (purchase_completed, session_started, …) with entity links. */
export async function recordServerEvent(input: {
  sessionId: string;
  name: PlatformEventName;
  props?: Record<string, string | number | boolean | null>;
  customerId?: string | null;
  productId?: string | null;
  configurationId?: string | null;
  orderId?: string | null;
  conversationId?: string | null;
  experimentId?: string | null;
  page?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.insert(events).values({
    id: newId("evt"),
    sessionId: input.sessionId,
    customerId: input.customerId ?? null,
    name: input.name,
    page: input.page ?? null,
    productId: input.productId ?? null,
    configurationId: input.configurationId ?? null,
    orderId: input.orderId ?? null,
    conversationId: input.conversationId ?? null,
    experimentId: input.experimentId ?? null,
    propsJson: input.props ?? {},
    clientEventId: newId("evt"),
    occurredAt: new Date(),
  });
}

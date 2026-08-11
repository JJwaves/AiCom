import type { ProductConfiguration } from "@/types/commerce";

/**
 * Client-side configuration sync bus (Session 06).
 *
 * The Packaging Expert chat is mounted in the root layout; the configurator
 * store lives inside the product page — different React trees, so context
 * cannot connect them. This tiny module-level pub/sub is the typed channel:
 *
 *   chat → bus:  server-validated AI configuration updates (apply + highlight)
 *   store → bus: presence registration, so the chat knows whether the
 *                product's configurator is on screen (chip behavior, and the
 *                mobile launcher lifts above the sticky Add-to-Cart bar)
 *
 * Payloads are always SERVER-validated configurations (from /api responses)
 * — never model output. Module state is per-tab and ephemeral by design;
 * the database row is the durable truth.
 */

export type AiConfigurationUpdate = {
  productId: string;
  config: ProductConfiguration;
  /** Server row version — the store ignores revisions it has already passed. */
  revision: number;
};

type Listener = (update: AiConfigurationUpdate) => void;

const listeners = new Set<Listener>();
/** productId → mounted-configurator count (StrictMode double-mounts safely). */
const mounted = new Map<string, number>();
const presenceListeners = new Set<() => void>();

export function publishAiConfigurationUpdate(update: AiConfigurationUpdate): void {
  for (const listener of [...listeners]) {
    try {
      listener(update);
    } catch (err) {
      console.error("[configuration] sync listener failed", err);
    }
  }
}

export function subscribeToAiConfigurationUpdates(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Register a mounted configurator; returns its unregister cleanup. */
export function registerMountedConfigurator(productId: string): () => void {
  mounted.set(productId, (mounted.get(productId) ?? 0) + 1);
  for (const l of [...presenceListeners]) l();
  return () => {
    const next = (mounted.get(productId) ?? 1) - 1;
    if (next <= 0) mounted.delete(productId);
    else mounted.set(productId, next);
    for (const l of [...presenceListeners]) l();
  };
}

export function isConfiguratorMounted(productId?: string): boolean {
  if (productId !== undefined) return (mounted.get(productId) ?? 0) > 0;
  return mounted.size > 0;
}

/** Presence subscription for useSyncExternalStore (chat launcher offsets, chip enablement). */
export function subscribeToConfiguratorPresence(listener: () => void): () => void {
  presenceListeners.add(listener);
  return () => presenceListeners.delete(listener);
}

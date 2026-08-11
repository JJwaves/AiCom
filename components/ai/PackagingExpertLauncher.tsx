import { isFlagEnabled } from "@/config/flags";
import { isAiRuntimeAvailable } from "@/lib/ai";
import { PackagingExpertChat } from "./PackagingExpertChat";

/**
 * Server-side gate for the AI Packaging Expert surface (Session 05).
 *
 * Renders nothing unless AI_RUNTIME + AI_SALES are enabled AND the runtime
 * is actually usable (provider key present) — flags off means the storefront
 * ships zero AI UI and the client bundle contains no dangling chat state.
 * The flags are server env (never NEXT_PUBLIC), so this decision cannot be
 * made — or tampered with — client-side.
 */
export function PackagingExpertLauncher() {
  if (!isFlagEnabled("AI_RUNTIME") || !isFlagEnabled("AI_SALES") || !isAiRuntimeAvailable()) {
    return null;
  }
  return <PackagingExpertChat />;
}

import type { ArtworkRef, Product, ProductConfiguration } from "@/types/commerce";
import {
  applyConfigurationPatch,
  defaultConfiguration,
  PATCHABLE_FIELDS,
  type ConfigurationPatch,
  type PatchableField,
} from "./validation";

/**
 * The shared configuration store (Session 06) — ONE authoritative
 * ProductConfiguration per mounted product page, mutated only through this
 * reducer. The visual configurator dispatches user actions; AI updates
 * arrive as server-validated LOAD_SERVER_CONFIGURATION actions (the client
 * NEVER applies model-generated values directly — it applies what the
 * server validated, persisted, and returned).
 *
 * Pure + deterministic: no IO, no clocks — persistence and timers live in
 * the React layer (context.tsx). Unit-tested framework-free.
 */

export type ChangeSource = "user" | "ai" | "load" | "reset";

/** Fields tracked for dirtiness/highlights: the patchable option fields + artwork. */
export type TrackedField = PatchableField | "artwork";

export type ConfigurationState = {
  config: ProductConfiguration;
  /**
   * Server revision this state last saw (product_configurations.version).
   * 0 = nothing persisted yet. Only server responses advance it.
   */
  revision: number;
  /** Locally changed fields not yet acknowledged by a server sync. */
  dirtyFields: TrackedField[];
  /** Last applied change — drives highlight + aria-live announcements. */
  lastChange: { source: ChangeSource; fields: TrackedField[] } | null;
};

export type ConfigurationAction =
  | { type: "SET_SIZE"; sizeId: string }
  | { type: "SET_MATERIAL"; materialId: string }
  | { type: "SET_COLOR"; colorId: string }
  | { type: "SET_PRINT_OPTION"; printOptionId: ProductConfiguration["printOptionId"] }
  | { type: "SET_QUANTITY"; quantity: number }
  | { type: "SET_ARTWORK"; artwork: ArtworkRef | null }
  /**
   * Server-validated configuration arriving from outside this tree:
   * "ai" = an AI update published by the chat widget; "load" = the initial
   * session restore. Stale revisions (≤ current) are ignored, and fields
   * with unsynced local edits keep the LOCAL value — a customer's in-flight
   * click is never visually clobbered by a concurrent AI turn.
   */
  | { type: "LOAD_SERVER_CONFIGURATION"; config: ProductConfiguration; revision: number; source: "ai" | "load" }
  /**
   * Server acknowledged persisting `syncedConfig`. A field leaves the dirty
   * set only when its current value still equals what was synced — an edit
   * made while the request was in flight stays dirty for the next sync.
   */
  | { type: "SYNC_ACKNOWLEDGED"; revision: number; syncedConfig: ProductConfiguration }
  | { type: "RESET_CONFIGURATION" };

export function initialConfigurationState(product: Product): ConfigurationState {
  return { config: defaultConfiguration(product), revision: 0, dirtyFields: [], lastChange: null };
}

const union = (a: TrackedField[], b: TrackedField[]): TrackedField[] => [...new Set([...a, ...b])];

/** Reducer factory — the product defines the legal option space. */
export function configurationReducer(
  product: Product,
  state: ConfigurationState,
  action: ConfigurationAction,
): ConfigurationState {
  const applyUserPatch = (patch: ConfigurationPatch): ConfigurationState => {
    const result = applyConfigurationPatch(product, state.config, patch);
    // Illegal values cannot originate from our own UI (buttons render only
    // catalog options); treat as a no-op rather than corrupt state.
    if (!result.ok || result.changedFields.length === 0) return state;
    return {
      ...state,
      config: result.config,
      dirtyFields: union(state.dirtyFields, result.changedFields),
      lastChange: { source: "user", fields: result.changedFields },
    };
  };

  switch (action.type) {
    case "SET_SIZE":
      return applyUserPatch({ sizeId: action.sizeId });
    case "SET_MATERIAL":
      return applyUserPatch({ materialId: action.materialId });
    case "SET_COLOR":
      return applyUserPatch({ colorId: action.colorId });
    case "SET_PRINT_OPTION":
      return applyUserPatch({ printOptionId: action.printOptionId });
    case "SET_QUANTITY":
      return applyUserPatch({ quantity: action.quantity });
    case "SET_ARTWORK": {
      if ((state.config.artwork ?? null) === action.artwork) return state;
      return {
        ...state,
        config: { ...state.config, artwork: action.artwork },
        dirtyFields: union(state.dirtyFields, ["artwork"]),
        lastChange: { source: "user", fields: ["artwork"] },
      };
    }
    case "LOAD_SERVER_CONFIGURATION": {
      if (action.config.productId !== product.id) return state;
      if (action.revision <= state.revision) return state; // stale — this state already moved past it
      // Field-level merge: locally dirty fields keep the local value (the
      // next sync re-asserts them server-side); everything else takes the
      // server value. Artwork only ever comes from the local uploader.
      const merged: ProductConfiguration = { ...action.config, artwork: state.config.artwork ?? null };
      for (const field of state.dirtyFields) {
        if (field === "artwork") continue;
        (merged as Record<PatchableField, string | number>)[field] = state.config[field] as string | number;
      }
      const changedFields = PATCHABLE_FIELDS.filter((f) => merged[f] !== state.config[f]);
      if (changedFields.length === 0) {
        return { ...state, revision: action.revision };
      }
      return {
        config: merged,
        revision: action.revision,
        dirtyFields: state.dirtyFields,
        lastChange: action.source === "ai" ? { source: "ai", fields: changedFields } : { source: "load", fields: changedFields },
      };
    }
    case "SYNC_ACKNOWLEDGED": {
      const stillDirty = (field: TrackedField): boolean => {
        if (field === "artwork") return (state.config.artwork ?? null) !== (action.syncedConfig.artwork ?? null);
        return state.config[field] !== action.syncedConfig[field];
      };
      return {
        ...state,
        revision: Math.max(state.revision, action.revision),
        dirtyFields: state.dirtyFields.filter(stillDirty),
      };
    }
    case "RESET_CONFIGURATION": {
      const defaults = defaultConfiguration(product);
      const changed = PATCHABLE_FIELDS.filter((f) => defaults[f] !== state.config[f]);
      return {
        config: defaults,
        revision: state.revision,
        dirtyFields: union(state.dirtyFields, [...changed, ...(state.config.artwork ? (["artwork"] as const) : [])]),
        lastChange: { source: "reset", fields: changed },
      };
    }
    default:
      return state;
  }
}

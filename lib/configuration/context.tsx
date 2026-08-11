"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { ArtworkRef, Product, ProductConfiguration } from "@/types/commerce";
import {
  configurationReducer,
  initialConfigurationState,
  type ConfigurationState,
  type TrackedField,
} from "./store";
import { registerMountedConfigurator, subscribeToAiConfigurationUpdates } from "./sync-bus";

/**
 * React binding of the shared configuration store (Session 06).
 *
 * The provider owns the reducer and its side channels:
 *  - session restore: GET /api/configuration?productId=… on mount (a reload
 *    recovers the configuration the session already built — including AI
 *    changes made before the reload);
 *  - debounced persistence: dirty state POSTs to /api/configuration
 *    (source "configurator", CONFIGURATOR need-profile evidence) without
 *    ever blocking a click; failures keep the UI authoritative and retry
 *    on the next change;
 *  - AI sync: server-validated updates published by the chat widget apply
 *    through the same reducer (field-merged, revision-gated, announced).
 *
 * Commerce works with every AI flag off: this file never touches lib/ai,
 * and a failing/absent API just leaves a purely-local configurator.
 */

const SYNC_DEBOUNCE_MS = 700;

type ConfigurationContextValue = {
  state: ConfigurationState;
  config: ProductConfiguration;
  product: Product;
  setSize: (sizeId: string) => void;
  setMaterial: (materialId: string) => void;
  setColor: (colorId: string) => void;
  setPrintOption: (printOptionId: ProductConfiguration["printOptionId"]) => void;
  setQuantity: (quantity: number) => void;
  setArtwork: (artwork: ArtworkRef | null) => void;
  /** Await the current state being persisted (used right before add-to-cart). */
  flushSync: () => Promise<void>;
};

const ConfigurationContext = createContext<ConfigurationContextValue | null>(null);

type SyncResponse = {
  ok: boolean;
  configuration?: { config: ProductConfiguration; revision: number } | null;
};

export function ConfigurationProvider({ product, children }: { product: Product; children: React.ReactNode }) {
  const [state, dispatch] = useReducer(
    (s: ConfigurationState, a: Parameters<typeof configurationReducer>[2]) => configurationReducer(product, s, a),
    product,
    initialConfigurationState,
  );

  // Refs so async callbacks always see the latest state without re-subscribing.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  // --- Presence + AI updates (chat widget ↔ this store) -------------------
  useEffect(() => {
    const unregister = registerMountedConfigurator(product.id);
    const unsubscribe = subscribeToAiConfigurationUpdates((update) => {
      if (update.productId !== product.id) return;
      dispatch({ type: "LOAD_SERVER_CONFIGURATION", config: update.config, revision: update.revision, source: "ai" });
    });
    return () => {
      unregister();
      unsubscribe();
    };
  }, [product.id]);

  // --- Session restore (reload / return visit) ----------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/configuration?productId=${encodeURIComponent(product.id)}`, { method: "GET" });
        if (!res.ok) return;
        const data = (await res.json()) as SyncResponse;
        if (cancelled || !data.ok || !data.configuration) return;
        dispatch({
          type: "LOAD_SERVER_CONFIGURATION",
          config: data.configuration.config,
          revision: data.configuration.revision,
          source: "load",
        });
      } catch {
        // Restore is a convenience; a fresh default configurator is fine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  // --- Debounced persistence ---------------------------------------------
  const runSync = useCallback(async (): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const snapshot = stateRef.current;
    if (snapshot.dirtyFields.length === 0) return;
    const body = JSON.stringify({ productId: product.id, config: snapshot.config });
    const request = (async () => {
      try {
        const res = await fetch("/api/configuration", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        if (!res.ok) return; // stays dirty; retried on the next change
        const data = (await res.json()) as SyncResponse;
        if (data.ok && data.configuration) {
          dispatch({
            type: "SYNC_ACKNOWLEDGED",
            revision: data.configuration.revision,
            syncedConfig: snapshot.config,
          });
        }
      } catch {
        // Offline/failed — the visible UI stays authoritative; nothing is lost locally.
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = request;
    return request;
  }, [product.id]);

  useEffect(() => {
    if (state.dirtyFields.length === 0) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      void runSync();
    }, SYNC_DEBOUNCE_MS);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [state.dirtyFields, state.config, runSync]);

  const flushSync = useCallback(async () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    await inFlight.current; // let an in-flight sync settle first
    await runSync();
  }, [runSync]);

  const value = useMemo<ConfigurationContextValue>(
    () => ({
      state,
      config: state.config,
      product,
      setSize: (sizeId) => dispatch({ type: "SET_SIZE", sizeId }),
      setMaterial: (materialId) => dispatch({ type: "SET_MATERIAL", materialId }),
      setColor: (colorId) => dispatch({ type: "SET_COLOR", colorId }),
      setPrintOption: (printOptionId) => dispatch({ type: "SET_PRINT_OPTION", printOptionId }),
      setQuantity: (quantity) => dispatch({ type: "SET_QUANTITY", quantity }),
      setArtwork: (artwork) => dispatch({ type: "SET_ARTWORK", artwork }),
      flushSync,
    }),
    [state, product, flushSync],
  );

  return <ConfigurationContext.Provider value={value}>{children}</ConfigurationContext.Provider>;
}

export function useConfiguration(): ConfigurationContextValue {
  const ctx = useContext(ConfigurationContext);
  if (!ctx) throw new Error("useConfiguration must be used inside ConfigurationProvider");
  return ctx;
}

export type { ConfigurationState, TrackedField };

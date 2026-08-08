"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Cart, CartLine, ProductConfiguration } from "@/types/commerce";

/**
 * Cart state — client-side, persisted to localStorage.
 * Prices are snapshots; the mock checkout re-renders them, and the Shopify
 * checkout re-prices authoritatively server-side.
 */

const STORAGE_KEY = "bd_cart_v1";

type CartContextValue = {
  cart: Cart;
  addLine: (line: Omit<CartLine, "lineId">) => void;
  removeLine: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number, unitPriceCents: number) => void;
  clear: () => void;
  count: number;
  subtotalCents: number;
};

const CartContext = createContext<CartContextValue | null>(null);

const EMPTY: Cart = { lines: [], currency: "USD" };

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<Cart>(EMPTY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // SSR-safe hydration: localStorage only exists client-side, so the first
    // client render must start empty and sync from storage in an effect.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setCart(JSON.parse(raw) as Cart);
    } catch {
      /* corrupted storage — start clean */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch {
      /* storage full/unavailable */
    }
  }, [cart, hydrated]);

  const addLine = useCallback((line: Omit<CartLine, "lineId">) => {
    setCart((c) => ({
      ...c,
      lines: [...c.lines, { ...line, lineId: `L${Date.now().toString(36)}${c.lines.length}` }],
    }));
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.lineId !== lineId) }));
  }, []);

  const updateQuantity = useCallback((lineId: string, quantity: number, unitPriceCents: number) => {
    setCart((c) => ({
      ...c,
      lines: c.lines.map((l) =>
        l.lineId === lineId
          ? {
              ...l,
              config: { ...l.config, quantity } as ProductConfiguration,
              unitPriceCents,
              totalCents: unitPriceCents * quantity,
            }
          : l,
      ),
    }));
  }, []);

  const clear = useCallback(() => setCart(EMPTY), []);

  const value = useMemo<CartContextValue>(() => {
    const subtotalCents = cart.lines.reduce((sum, l) => sum + l.totalCents, 0);
    return { cart, addLine, removeLine, updateQuantity, clear, count: cart.lines.length, subtotalCents };
  }, [cart, addLine, removeLine, updateQuantity, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}

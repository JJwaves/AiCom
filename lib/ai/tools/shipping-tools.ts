import { z } from "zod";
import { estimateShipping } from "@/config/shipping";
import type { ToolDefinition } from "./types";

/**
 * Shipping tool — delegates to config/shipping's honest estimator. It is the
 * ONLY shipping-figure source available to the model.
 *
 *   mode:"flat"        the MVP flat U.S. charge, one per order — the model
 *                      may state this amount, because it is a configured
 *                      customer charge rather than an estimate.
 *   mode:"unavailable" we do not ship to that market (Canada, today). Relay
 *                      it; never quote the US rate for it.
 *   mode:"checkout"    no rate source — "calculated at checkout", verbatim.
 *
 * No mode carries a delivery DATE, deliberately: nothing in this system
 * knows one, so the model has nothing to repeat.
 */

const shippingOutput = z.union([
  z.object({ mode: z.literal("invalid"), message: z.string() }),
  z.object({ mode: z.literal("checkout"), message: z.string() }),
  z.object({ mode: z.literal("unavailable"), message: z.string() }),
  z.object({ mode: z.literal("flat"), message: z.string(), costCents: z.number().int() }),
  z.object({
    mode: z.literal("estimate"),
    message: z.string(),
    costCents: z.number().int(),
    transitDays: z.tuple([z.number(), z.number()]),
  }),
]);

export const getShippingEstimateTool: ToolDefinition<{ postalCode: string }, z.infer<typeof shippingOutput>> = {
  name: "getShippingEstimate",
  description:
    "Shipping availability and charge for a postal code. mode:'flat' is the configured flat U.S. shipping charge, " +
    "once per order — you may state it. mode:'unavailable' means we do not ship there; relay that. mode:'checkout' " +
    "means shipping is calculated at checkout — relay exactly that. Never invent shipping costs or delivery dates.",
  permission: "READ",
  inputSchema: z.object({ postalCode: z.string().trim().min(1).max(12) }),
  outputSchema: shippingOutput,
  async execute(input) {
    return estimateShipping(input.postalCode);
  },
};

import { z } from "zod";
import { estimateShipping } from "@/config/shipping";
import type { ToolDefinition } from "./types";

/**
 * Shipping tool — delegates to config/shipping's honest estimator. With no
 * rate source configured it reports "calculated at checkout"; the AI must
 * relay that honestly, never invent shipping costs or transit promises.
 */

const shippingOutput = z.union([
  z.object({ mode: z.literal("invalid"), message: z.string() }),
  z.object({ mode: z.literal("checkout"), message: z.string() }),
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
    "Shipping availability/estimate for a US ZIP or Canadian postal code. mode:'checkout' means shipping is calculated at " +
    "checkout — relay exactly that; do not invent shipping costs or delivery dates.",
  permission: "READ",
  inputSchema: z.object({ postalCode: z.string().trim().min(1).max(12) }),
  outputSchema: shippingOutput,
  async execute(input) {
    return estimateShipping(input.postalCode);
  },
};

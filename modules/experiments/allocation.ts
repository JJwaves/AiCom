import { z } from "zod";
import { EXPERIMENTS } from "@/config/experiments";
import { CONTROL_VARIANT_KEY } from "./types";

/**
 * Traffic allocation (Session 11 spec §10, §27).
 *
 * An allocation is a list of arms with WHOLE-PERCENT shares that must total
 * exactly 100. "Control 50 / Variant 50" and "Control 80 / Variant 20" are
 * both valid; negatives, fractions, duplicates, a missing control arm and
 * anything that does not total 100 are validation failures.
 *
 * Separately, the NON-CONTROL share is the fraction of eligible traffic the
 * experiment actually takes, and it is capped by
 * `config/experiments.ts → resolveTrafficCap()`. A missing business limit
 * is never read as "no limit".
 */

export const variantKeySchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "Variant keys are lowercase snake_case identifiers");

export const allocationEntrySchema = z
  .object({
    variant: variantKeySchema,
    /** Whole percent of eligible traffic. */
    pct: z.number().int().min(0).max(100),
  })
  .strict();

export const allocationSchema = z.array(allocationEntrySchema).min(2).max(8);

export type AllocationEntry = z.infer<typeof allocationEntrySchema>;
export type Allocation = AllocationEntry[];

export type AllocationValidation =
  | { ok: true; allocation: Allocation; nonControlPct: number }
  | { ok: false; errors: string[] };

/**
 * Structural validation. `maxNonControlPct` (when given) additionally
 * enforces the experiment traffic ceiling.
 */
export function validateAllocation(input: unknown, opts: { maxNonControlPct?: number } = {}): AllocationValidation {
  const parsed = allocationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const allocation = parsed.data;
  const errors: string[] = [];

  const keys = allocation.map((a) => a.variant);
  if (new Set(keys).size !== keys.length) errors.push("Allocation contains duplicate variant keys");
  if (!keys.includes(CONTROL_VARIANT_KEY)) errors.push(`Allocation must contain a "${CONTROL_VARIANT_KEY}" arm`);

  const total = allocation.reduce((sum, a) => sum + a.pct, 0);
  if (total !== 100) errors.push(`Allocation must total exactly 100% (got ${total}%)`);

  if (allocation.length > EXPERIMENTS.MAX_VARIANTS_PER_EXPERIMENT) {
    errors.push(
      `Session 11 supports control + ${EXPERIMENTS.MAX_VARIANTS_PER_EXPERIMENT - 1} variant (got ${allocation.length} arms); ` +
        "multi-arm tests need a multiple-comparison correction that is deliberately not implemented",
    );
  }

  const nonControlPct = allocation.filter((a) => a.variant !== CONTROL_VARIANT_KEY).reduce((s, a) => s + a.pct, 0);
  if (nonControlPct <= 0) errors.push("An experiment must send some traffic to a non-control variant");
  if (opts.maxNonControlPct !== undefined && nonControlPct > opts.maxNonControlPct) {
    errors.push(
      `Variant traffic ${nonControlPct}% exceeds the maximum experiment traffic share of ${opts.maxNonControlPct}%`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, allocation, nonControlPct };
}

/** The single non-control arm's key (MVP shape), or null. */
export function variantKeyOf(allocation: Allocation): string | null {
  return allocation.find((a) => a.variant !== CONTROL_VARIANT_KEY)?.variant ?? null;
}

/** A 50/50 control-vs-variant allocation, clamped to the given ceiling. */
export function evenAllocation(variantKey: string, maxNonControlPct: number): Allocation {
  const variantPct = Math.max(1, Math.min(50, Math.floor(maxNonControlPct)));
  return [
    { variant: CONTROL_VARIANT_KEY, pct: 100 - variantPct },
    { variant: variantKey, pct: variantPct },
  ];
}

/** Deterministic ordering: control first, then variants alphabetically. */
export function normalizeAllocation(allocation: Allocation): Allocation {
  return [...allocation].sort((a, b) => {
    if (a.variant === CONTROL_VARIANT_KEY) return -1;
    if (b.variant === CONTROL_VARIANT_KEY) return 1;
    return a.variant.localeCompare(b.variant);
  });
}

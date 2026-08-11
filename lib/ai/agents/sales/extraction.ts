import { z } from "zod";
import {
  applyNeedProfileUpdate,
  needProfileUpdateSchema,
  type NeedProfileUpdate,
} from "@/lib/data/customer-need-service";
import type { AiRuntime } from "../../runtime";
import { aiLog } from "../../log";

/**
 * Evidence-validated need extraction (Session 05 spec §7–§9).
 *
 * The model proposes candidates; THE SERVER decides provenance. A candidate
 * becomes USER_STATED only when ALL of these hold:
 *
 *   1. the model marked it "stated" AND quoted supporting evidence,
 *   2. the evidence text actually occurs in the customer's real message
 *      (whitespace/case-normalized substring — fabricated quotes are
 *      DROPPED entirely, not demoted: hallucinated direct statements must
 *      not survive in any form),
 *   3. the value is consistent with that evidence (strings appear in it;
 *      numbers appear digit-for-digit; booleans require the field's topic
 *      keyword),
 *   4. the value passes the field's zod schema, and
 *   5. the field is not judgment-only (priceSensitivity/purchaseIntent are
 *      interpretations by definition — never USER_STATED via extraction).
 *
 * Anything that fails 3–5 (but has honest evidence) is stored as
 * AI_INFERRED — data about our guess. Hedged numbers ("about 5,000") also
 * demote to AI_INFERRED: the S03 doctrine that vague quantities never
 * become authoritative numbers applies to provenance rank, not to memory.
 * Provenance precedence in applyNeedProfileUpdate still gates every write,
 * so even a validated USER_STATED extraction can be replaced by a later
 * explicit statement, and an inferred value can never displace one.
 */

/** Scalar fields the extractor may propose (arrays are a later session; conversationSummary belongs to the summarizer). */
export const EXTRACTION_FIELDS = [
  "businessName",
  "businessType",
  "industry",
  "location",
  "estimatedDailyOrders",
  "estimatedMonthlyUsage",
  "productInterest",
  "desiredCapacity",
  "materialPreference",
  "gsmPreference",
  "colorPreference",
  "handlePreference",
  "printingRequirement",
  "printingColors",
  "printingSides",
  "logoAvailable",
  "quantity",
  "budgetCents",
  "targetUnitPriceCents",
  "shippingPostalCode",
  "desiredDeliveryDate",
  "priceSensitivity",
  "purchaseIntent",
] as const;

export type ExtractionField = (typeof EXTRACTION_FIELDS)[number];

/** Judgment labels — interpretations of the customer, never their words. */
const INFERRED_ONLY_FIELDS: ReadonlySet<ExtractionField> = new Set(["priceSensitivity", "purchaseIntent"]);

/** Boolean fields can't textually "contain" their value — require the topic keyword in the evidence instead. */
const BOOLEAN_EVIDENCE_KEYWORDS: Partial<Record<ExtractionField, RegExp>> = {
  logoAvailable: /logo|artwork|design|brand/i,
};

/** Approximation language around a number — the customer stated a ballpark, not the number. */
const HEDGE_PATTERN = /\b(about|around|roughly|approximately|approx|maybe|perhaps|or so|ish|at least|up to|~)\b|~/i;

export const extractionCandidateSchema = z.object({
  field: z.enum(EXTRACTION_FIELDS),
  value: z.union([z.string().max(500), z.number(), z.boolean()]),
  kind: z.enum(["stated", "inferred"]),
  /** Verbatim supporting phrase from the customer message — required for "stated" to survive. */
  evidence: z.string().max(400).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type ExtractionCandidate = z.infer<typeof extractionCandidateSchema>;

export const needExtractionSchema = z.object({
  candidates: z.array(extractionCandidateSchema).max(16),
});

export type NeedExtraction = z.infer<typeof needExtractionSchema>;

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
/** Digit view of a string: "5,000 bags" → "5000bags" — grouping-tolerant number matching. */
const digits = (s: string): string => s.replace(/[,\s]/g, "");

export type DropReason =
  | "missing_evidence"
  | "evidence_not_in_message"
  | "invalid_value";

export type ValidatedExtraction = {
  stated: NeedProfileUpdate;
  statedConfidence: Partial<Record<keyof NeedProfileUpdate, number>>;
  inferred: NeedProfileUpdate;
  inferredConfidence: Partial<Record<keyof NeedProfileUpdate, number>>;
  dropped: { field: ExtractionField; reason: DropReason }[];
  /** stated → inferred demotions (kept, but only as our guess). */
  demoted: ExtractionField[];
};

function valueConsistentWithEvidence(field: ExtractionField, value: string | number | boolean, evidence: string): boolean {
  if (typeof value === "number") {
    // The value must equal a COMPLETE number in the evidence (grouping-tolerant):
    // "5,000" states 5000 — not 500, not 50. Partial digit matches are claims
    // the customer never made.
    const runs: string[] = digits(normalize(evidence)).match(/\d+(?:\.\d+)?/g) ?? [];
    return runs.includes(String(value));
  }
  if (typeof value === "boolean") {
    const keyword = BOOLEAN_EVIDENCE_KEYWORDS[field];
    return keyword ? keyword.test(evidence) : false;
  }
  return normalize(evidence).includes(normalize(value));
}

/**
 * Pure server-side validation of model-proposed candidates against the
 * customer's ACTUAL message. This function is the authority on provenance —
 * the model only ever supplies suggestions.
 */
export function validateExtraction(extraction: NeedExtraction, userMessage: string): ValidatedExtraction {
  const result: ValidatedExtraction = {
    stated: {},
    statedConfidence: {},
    inferred: {},
    inferredConfidence: {},
    dropped: [],
    demoted: [],
  };
  const messageNorm = normalize(userMessage);

  for (const candidate of extraction.candidates) {
    const { field } = candidate;
    // The field's own zod schema is the value gate for BOTH provenance levels.
    // (The shape lookup is a union of per-field schemas; widen to call safeParse.)
    const fieldSchema = needProfileUpdateSchema.shape[field] as z.ZodType<unknown>;
    const parsedValue = fieldSchema.safeParse(candidate.value);
    if (!parsedValue.success || parsedValue.data === undefined) {
      result.dropped.push({ field, reason: "invalid_value" });
      continue;
    }
    // Every extractable field schema outputs a scalar (trimmed string / number / boolean).
    const value = parsedValue.data as string | number | boolean;

    const storeInferred = () => {
      (result.inferred as Record<string, unknown>)[field] = value;
      if (candidate.confidence !== undefined) result.inferredConfidence[field] = candidate.confidence;
    };

    if (candidate.kind === "inferred") {
      storeInferred();
      continue;
    }

    // kind === "stated" — earn the rank or lose it.
    if (INFERRED_ONLY_FIELDS.has(field)) {
      result.demoted.push(field);
      storeInferred();
      continue;
    }
    if (!candidate.evidence || candidate.evidence.trim() === "") {
      result.dropped.push({ field, reason: "missing_evidence" });
      continue;
    }
    if (!messageNorm.includes(normalize(candidate.evidence))) {
      // Fabricated quote — hallucinated direct statements do not survive at all.
      result.dropped.push({ field, reason: "evidence_not_in_message" });
      continue;
    }
    const hedgedNumber = typeof value === "number" && HEDGE_PATTERN.test(candidate.evidence);
    if (!valueConsistentWithEvidence(field, value, candidate.evidence) || hedgedNumber) {
      result.demoted.push(field);
      storeInferred();
      continue;
    }
    (result.stated as Record<string, unknown>)[field] = value;
    if (candidate.confidence !== undefined) result.statedConfidence[field] = candidate.confidence;
  }
  return result;
}

export type ExtractionOutcome = {
  statedApplied: string[];
  inferredApplied: string[];
  dropped: ValidatedExtraction["dropped"];
  demoted: ExtractionField[];
};

/**
 * Run LOW_COST extraction over one user message and apply the validated
 * result to the CustomerNeedProfile: verified candidates as USER_STATED,
 * honest guesses as AI_INFERRED. Both writes go through the row-locked
 * applyNeedProfileUpdate, whose rank gate remains the final authority.
 */
export async function runNeedExtraction(opts: {
  runtime: AiRuntime;
  sessionId: string;
  conversationId: string;
  customerId?: string | null;
  userMessage: string;
}): Promise<ExtractionOutcome> {
  const extraction = await opts.runtime.generateStructuredObject({
    workload: "LOW_COST",
    prompt: { id: "ai_sales_need_extraction" },
    messages: [{ role: "user", content: opts.userMessage }],
    schema: needExtractionSchema,
    agentType: "sales",
    sessionId: opts.sessionId,
    conversationId: opts.conversationId,
  });

  const validated = validateExtraction(extraction, opts.userMessage);
  const outcome: ExtractionOutcome = {
    statedApplied: [],
    inferredApplied: [],
    dropped: validated.dropped,
    demoted: validated.demoted,
  };

  if (Object.keys(validated.stated).length > 0) {
    const { appliedFields } = await applyNeedProfileUpdate(opts.sessionId, validated.stated, "USER_STATED", {
      fieldConfidence: validated.statedConfidence,
      customerId: opts.customerId ?? null,
    });
    outcome.statedApplied = appliedFields;
  }
  if (Object.keys(validated.inferred).length > 0) {
    const { appliedFields } = await applyNeedProfileUpdate(opts.sessionId, validated.inferred, "AI_INFERRED", {
      fieldConfidence: validated.inferredConfidence,
      customerId: opts.customerId ?? null,
    });
    outcome.inferredApplied = appliedFields;
  }

  if (validated.dropped.length > 0) {
    aiLog("extraction_candidates_dropped", {
      sessionId: opts.sessionId,
      conversationId: opts.conversationId,
      dropped: validated.dropped.map((d) => `${d.field}:${d.reason}`).join(","),
    });
  }
  return outcome;
}

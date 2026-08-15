import { describe, expect, it } from "vitest";
import { EXPERIMENTS, resolveTrafficCap } from "@/config/experiments";
import {
  assignVariant,
  assignmentBucket,
  audienceSchema,
  canTransition,
  classifyDevice,
  computeReadout,
  CONTROL_VARIANT_KEY,
  DEFAULT_AUDIENCE,
  EXPERIMENT_TARGETS,
  EXPERIMENT_TARGET_KEYS,
  effectiveMinimumSample,
  evenAllocation,
  getExperimentTarget,
  isBotUserAgent,
  isEligible,
  matchRoute,
  normalCdf,
  parseExperimentDesign,
  targetRendersOnPath,
  twoProportionZTest,
  unsafeTextReason,
  validateAllocation,
  validateVariantConfig,
  variantForBucket,
  type Allocation,
} from "@/modules/experiments";

/**
 * Session 11 — the deterministic experiment engine (spec §6–§18, §50–§51).
 *
 * Everything here is pure: no database, no network, no AI. These tests pin
 * down the properties the whole session rests on — closed targets, closed
 * variant schemas, valid allocations, sticky deterministic assignment,
 * fail-closed eligibility, and a statistical engine that refuses to produce
 * a winner it cannot defend.
 */

/* ------------------------------------------------------------------ */
/* Variant safety (spec §6)                                            */
/* ------------------------------------------------------------------ */

describe("safe variant model", () => {
  const target = "product.shipping_message";

  it("accepts plain customer-facing copy", () => {
    const result = validateVariantConfig(target, "SHIPPING_MESSAGE", {
      message: "Production starts once you approve the artwork proof.",
      placement: "above_cta",
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["<script>alert(1)</script>", "angle brackets"],
    ["Ships {{soon}}", "braces"],
    ['javascript:alert(1)', "javascript: URL"],
    ["data:text/html;base64,PHNjcmlwdD4=", "data: URL"],
    ["Click me onclick=alert(1)", "inline event handler"],
    ["&#60;b&#62;", "HTML entities"],
    ["back\\slash", "backslashes"],
    ["Total: ${price}", "template interpolation"],
  ])("rejects %s as unsafe variant copy", (copy) => {
    expect(unsafeTextReason(copy)).not.toBeNull();
    const result = validateVariantConfig(target, "SHIPPING_MESSAGE", { message: copy, placement: "above_cta" });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown fields — variant schemas are strict, never stripped", () => {
    const result = validateVariantConfig(target, "SHIPPING_MESSAGE", {
      message: "Ships in bulk.",
      placement: "above_cta",
      html: "<b>hi</b>",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/validation/i);
  });

  it("rejects a variant whose experiment type does not match the target", () => {
    const result = validateVariantConfig(target, "HERO_COPY", { headline: "Bags" });
    expect(result.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Target registry (spec §7)                                           */
/* ------------------------------------------------------------------ */

describe("experiment target registry is closed", () => {
  it("fails closed on an unknown target key", () => {
    expect(getExperimentTarget("checkout.payment_form")).toBeNull();
    expect(validateVariantConfig("checkout.payment_form", "CTA_COPY", { ctaLabel: "Pay" }).ok).toBe(false);
    expect(targetRendersOnPath("checkout.payment_form", "/cart")).toBe(false);
  });

  it("registers only presentation surfaces — no checkout, pricing, admin or auth target exists", () => {
    for (const key of EXPERIMENT_TARGET_KEYS) {
      expect(key).not.toMatch(/checkout|payment|price|pricing|admin|auth|consent|privacy/i);
    }
  });

  it("every target names a real rendering component and a control description", () => {
    for (const target of Object.values(EXPERIMENT_TARGETS)) {
      expect(target.renderedBy).toMatch(/\.(tsx)$/);
      expect(target.describeControl().summary.length).toBeGreaterThan(10);
      expect(target.protectedFields.length).toBeGreaterThan(0);
    }
  });

  it("matches targets to the routes they render on", () => {
    expect(targetRendersOnPath("homepage.hero", "/")).toBe(true);
    expect(targetRendersOnPath("homepage.hero", "/products/x")).toBe(false);
    expect(targetRendersOnPath("product.primary_cta", "/products/custom-non-woven-takeout-bags")).toBe(true);
    expect(targetRendersOnPath("product.primary_cta", "/")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Traffic allocation (spec §10, §27)                                  */
/* ------------------------------------------------------------------ */

describe("traffic allocation validation", () => {
  const alloc = (...pairs: [string, number][]): Allocation => pairs.map(([variant, pct]) => ({ variant, pct }));

  it("accepts 50/50 and 80/20", () => {
    expect(validateAllocation(alloc(["control", 50], ["variant_b", 50])).ok).toBe(true);
    expect(validateAllocation(alloc(["control", 80], ["variant_b", 20])).ok).toBe(true);
  });

  it("rejects allocations that do not total 100", () => {
    const result = validateAllocation(alloc(["control", 50], ["variant_b", 40]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/total exactly 100/);
  });

  it("rejects negative shares", () => {
    expect(validateAllocation(alloc(["control", 120], ["variant_b", -20])).ok).toBe(false);
  });

  it("requires a control arm and some variant traffic", () => {
    expect(validateAllocation(alloc(["variant_a", 50], ["variant_b", 50])).ok).toBe(false);
    expect(validateAllocation(alloc(["control", 100], ["variant_b", 0])).ok).toBe(false);
  });

  it("enforces the traffic ceiling on the non-control share", () => {
    const result = validateAllocation(alloc(["control", 50], ["variant_b", 50]), { maxNonControlPct: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/exceeds the maximum experiment traffic share of 20%/);
  });

  it("never silently exposes 100% of traffic to a new variant", () => {
    expect(validateAllocation(alloc(["control", 0], ["variant_b", 100]), { maxNonControlPct: 50 }).ok).toBe(false);
  });

  it("caps the MVP at control + one variant", () => {
    const result = validateAllocation(alloc(["control", 34], ["variant_b", 33], ["variant_c", 33]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/multiple-comparison/);
  });
});

describe("traffic cap resolution (spec §27)", () => {
  it("never reads a missing business limit as 100%", () => {
    const cap = resolveTrafficCap({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(cap.ok).toBe(true);
    if (cap.ok) {
      expect(cap.capPct).toBe(EXPERIMENTS.DEV_ONLY_MAX_TRAFFIC_PCT);
      expect(cap.capPct).toBeLessThan(100);
      expect(cap.source).toBe("development_default");
    }
  });

  it("BLOCKS in production while the limit is unconfigured, naming the exact config path", () => {
    const cap = resolveTrafficCap({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(cap.ok).toBe(false);
    if (!cap.ok) {
      expect(cap.missingConfiguration).toContain("config/guardrails.ts → GUARDRAIL_LIMITS.maximumExperimentTrafficPct");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Assignment (spec §9)                                                */
/* ------------------------------------------------------------------ */

describe("deterministic assignment", () => {
  const allocation: Allocation = [
    { variant: "control", pct: 50 },
    { variant: "variant_b", pct: 50 },
  ];

  it("is a pure function: the same inputs always give the same arm", () => {
    for (let i = 0; i < 50; i += 1) {
      const sessionId = `sess_${i}`;
      const a = assignVariant({ experimentId: "exp_1", salt: "s", sessionId, allocation });
      const b = assignVariant({ experimentId: "exp_1", salt: "s", sessionId, allocation });
      expect(a).toBe(b);
    }
  });

  it("does not depend on the order the allocation was written in", () => {
    const reversed: Allocation = [...allocation].reverse();
    for (let i = 0; i < 20; i += 1) {
      const sessionId = `sess_${i}`;
      expect(assignVariant({ experimentId: "exp_1", salt: "s", sessionId, allocation })).toBe(
        assignVariant({ experimentId: "exp_1", salt: "s", sessionId, allocation: reversed }),
      );
    }
  });

  it("keeps arms independent across experiments (per-experiment salt)", () => {
    const sessions = Array.from({ length: 200 }, (_, i) => `sess_${i}`);
    const a = sessions.map((s) => assignVariant({ experimentId: "exp_1", salt: "s1", sessionId: s, allocation }));
    const b = sessions.map((s) => assignVariant({ experimentId: "exp_2", salt: "s2", sessionId: s, allocation }));
    const identical = a.filter((v, i) => v === b[i]).length;
    // Independent hashes agree ~50% of the time; identical assignment would be a bug.
    expect(identical).toBeGreaterThan(60);
    expect(identical).toBeLessThan(140);
  });

  it("respects the allocation shares over many sessions", () => {
    const eighty: Allocation = [
      { variant: "control", pct: 80 },
      { variant: "variant_b", pct: 20 },
    ];
    const sessions = Array.from({ length: 4000 }, (_, i) => `sess_${i}`);
    const variants = sessions.filter(
      (s) => assignVariant({ experimentId: "exp_x", salt: "salt", sessionId: s, allocation: eighty }) === "variant_b",
    ).length;
    const share = variants / sessions.length;
    expect(share).toBeGreaterThan(0.16);
    expect(share).toBeLessThan(0.24);
  });

  it("maps buckets to arms by cumulative share", () => {
    expect(variantForBucket(0, allocation)).toBe("control");
    expect(variantForBucket(4999, allocation)).toBe("control");
    expect(variantForBucket(5000, allocation)).toBe("variant_b");
    expect(variantForBucket(9999, allocation)).toBe("variant_b");
  });

  it("produces buckets inside [0, 10000)", () => {
    for (let i = 0; i < 100; i += 1) {
      const bucket = assignmentBucket("exp", "salt", `sess_${i}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(10_000);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Eligibility (spec §11, §30)                                         */
/* ------------------------------------------------------------------ */

describe("eligibility fails closed on ambiguity", () => {
  const ctx = (over: Partial<Parameters<typeof isEligible>[1]> = {}) => ({
    path: "/products/x",
    firstTouchSourceMedium: null,
    campaign: null,
    device: null,
    visitor: null,
    isAdminPath: false,
    isBot: false,
    ...over,
  });

  it("enrols when the audience is unrestricted", () => {
    expect(isEligible(DEFAULT_AUDIENCE, ctx()).eligible).toBe(true);
  });

  it("never enrols admin traffic", () => {
    const result = isEligible(DEFAULT_AUDIENCE, ctx({ isAdminPath: true }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("admin_traffic_excluded");
  });

  it("never enrols obvious automation", () => {
    expect(isEligible(DEFAULT_AUDIENCE, ctx({ isBot: true })).eligible).toBe(false);
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBotUserAgent("HeadlessChrome/120")).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36")).toBe(false);
  });

  it("does NOT enrol when a targeted attribute is unknown", () => {
    const audience = audienceSchema.parse({ device: "mobile" });
    const result = isEligible(audience, ctx({ device: null }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("device_unknown");
  });

  it("matches routes by exact path or prefix", () => {
    expect(matchRoute("/", "/")).toBe(true);
    expect(matchRoute("/", "/products/x")).toBe(false);
    expect(matchRoute("/products/", "/products/bag")).toBe(true);
    expect(matchRoute("/lp/*", "/lp/restaurant")).toBe(true);
  });

  it("classifies devices conservatively, returning null when unsure", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148")).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36")).toBe("desktop");
    expect(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0)")).toBeNull();
    expect(classifyDevice("weird")).toBeNull();
    expect(classifyDevice(null)).toBeNull();
  });

  it("rejects an audience with unknown selectors — no sensitive targeting can be expressed", () => {
    expect(audienceSchema.safeParse({ ageRange: "18-24" }).success).toBe(false);
    expect(audienceSchema.safeParse({ gender: "female" }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Statistics (spec §16, §51)                                          */
/* ------------------------------------------------------------------ */

describe("two-proportion z-test", () => {
  it("matches the standard normal CDF at known points", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 4);
  });

  it("finds a significant difference for 1000/50 vs 1000/80", () => {
    const result = twoProportionZTest(
      { variant: "control", exposedSessions: 1000, conversions: 50 },
      { variant: "variant_b", exposedSessions: 1000, conversions: 80 },
    );
    expect(result.preconditionsMet).toBe(true);
    expect(result.z).toBeCloseTo(2.72, 1);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.significant).toBe(true);
    expect(result.relativeLiftPct).toBeCloseTo(60, 0);
  });

  it("finds NO significant difference for 100/5 vs 100/7", () => {
    const result = twoProportionZTest(
      { variant: "control", exposedSessions: 100, conversions: 5 },
      { variant: "variant_b", exposedSessions: 100, conversions: 7 },
    );
    expect(result.preconditionsMet).toBe(true);
    expect(Math.abs(result.z!)).toBeLessThan(EXPERIMENTS.Z_CRITICAL_TWO_SIDED);
    expect(result.significant).toBe(false);
  });

  it("refuses to produce a p-value when a cell is too small", () => {
    const result = twoProportionZTest(
      { variant: "control", exposedSessions: 100, conversions: 1 },
      { variant: "variant_b", exposedSessions: 100, conversions: 2 },
    );
    expect(result.preconditionsMet).toBe(false);
    expect(result.z).toBeNull();
    expect(result.pValue).toBeNull();
    expect(result.significant).toBe(false);
  });

  it("handles a zero baseline without inventing a lift", () => {
    const result = twoProportionZTest(
      { variant: "control", exposedSessions: 1000, conversions: 0 },
      { variant: "variant_b", exposedSessions: 1000, conversions: 30 },
    );
    expect(result.controlRate).toBe(0);
    expect(result.relativeLiftPct).toBeNull();
    expect(result.preconditionsMet).toBe(false); // control has 0 conversions
  });

  it("is deterministic — repeated calls are byte-identical", () => {
    const args = [
      { variant: "control", exposedSessions: 1234, conversions: 77 },
      { variant: "variant_b", exposedSessions: 1198, conversions: 101 },
    ] as const;
    expect(JSON.stringify(twoProportionZTest(args[0], args[1]))).toBe(
      JSON.stringify(twoProportionZTest(args[0], args[1])),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Result states (spec §15, §17)                                       */
/* ------------------------------------------------------------------ */

describe("result determination", () => {
  const readout = (over: Partial<Parameters<typeof computeReadout>[0]> = {}) =>
    computeReadout({
      status: "running",
      primaryMetric: "add_to_cart",
      minimumSampleSize: 1000,
      configurationValid: true,
      arms: [
        { variant: "control", exposedSessions: 1000, conversions: 50 },
        { variant: "variant_b", exposedSessions: 1000, conversions: 80 },
      ],
      ...over,
    });

  it("declares VARIANT_WIN only after the minimum sample and a significant test", () => {
    const result = readout();
    expect(result.state).toBe("VARIANT_WIN");
    expect(result.winner).toBe("variant_b");
  });

  it("declares CONTROL_WIN when control converts significantly better", () => {
    const result = readout({
      arms: [
        { variant: "control", exposedSessions: 1000, conversions: 80 },
        { variant: "variant_b", exposedSessions: 1000, conversions: 50 },
      ],
    });
    expect(result.state).toBe("CONTROL_WIN");
    expect(result.winner).toBe(CONTROL_VARIANT_KEY);
  });

  it("stays RUNNING (never a winner) below the minimum sample", () => {
    const result = readout({
      arms: [
        { variant: "control", exposedSessions: 100, conversions: 5 },
        { variant: "variant_b", exposedSessions: 100, conversions: 40 },
      ],
    });
    expect(result.state).toBe("RUNNING");
    expect(result.winner).toBeNull();
    expect(result.statistics).toBeNull();
  });

  it("reports NO_CLEAR_WINNER rather than forcing a decision", () => {
    const result = readout({
      minimumSampleSize: 100,
      arms: [
        { variant: "control", exposedSessions: 1000, conversions: 50 },
        { variant: "variant_b", exposedSessions: 1000, conversions: 54 },
      ],
    });
    expect(result.state).toBe("NO_CLEAR_WINNER");
    expect(result.winner).toBeNull();
  });

  it("reports INSUFFICIENT_DATA when the sample is met but the test is invalid", () => {
    const result = readout({
      minimumSampleSize: 100,
      arms: [
        { variant: "control", exposedSessions: 1000, conversions: 1 },
        { variant: "variant_b", exposedSessions: 1000, conversions: 2 },
      ],
    });
    expect(result.state).toBe("INSUFFICIENT_DATA");
    expect(result.winner).toBeNull();
  });

  it("reports STOPPED when a human ended it below the threshold", () => {
    const result = readout({
      status: "stopped",
      arms: [
        { variant: "control", exposedSessions: 10, conversions: 1 },
        { variant: "variant_b", exposedSessions: 10, conversions: 3 },
      ],
    });
    expect(result.state).toBe("STOPPED");
    expect(result.winner).toBeNull();
  });

  it("reports INVALID when the stored configuration no longer validates", () => {
    const result = readout({ configurationValid: false, configurationIssues: ["Unknown target"] });
    expect(result.state).toBe("INVALID");
    expect(result.caveats).toContain("Unknown target");
  });

  it("handles a zero baseline without dividing by zero", () => {
    const result = readout({
      minimumSampleSize: 100,
      arms: [
        { variant: "control", exposedSessions: 1000, conversions: 0 },
        { variant: "variant_b", exposedSessions: 1000, conversions: 0 },
      ],
    });
    expect(["INSUFFICIENT_DATA", "NO_CLEAR_WINNER"]).toContain(result.state);
    expect(result.winner).toBeNull();
  });

  it("lets an experiment RAISE the minimum sample but never lower the documented floor", () => {
    expect(effectiveMinimumSample(10)).toBe(EXPERIMENTS.DEFAULT_MINIMUM_SAMPLE_PER_VARIANT);
    expect(effectiveMinimumSample(null)).toBe(EXPERIMENTS.DEFAULT_MINIMUM_SAMPLE_PER_VARIANT);
    expect(effectiveMinimumSample(50_000)).toBe(50_000);
  });
});

/* ------------------------------------------------------------------ */
/* Design parsing (spec §5, §22)                                       */
/* ------------------------------------------------------------------ */

describe("experiment design validation", () => {
  const design = (over: Record<string, unknown> = {}) => ({
    targetKey: "product.shipping_message",
    experimentType: "SHIPPING_MESSAGE",
    variantConfig: { message: "Production starts after you approve the proof.", placement: "above_cta" },
    primaryMetric: "add_to_cart",
    allocation: evenAllocation("variant_b", 50),
    ...over,
  });

  it("accepts a well-formed design", () => {
    const result = parseExperimentDesign(design());
    expect(result.ok).toBe(true);
  });

  it("fails closed on an unknown target", () => {
    const result = parseExperimentDesign(design({ targetKey: "checkout.button" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Unknown experiment target/);
  });

  it("rejects a metric outside the closed primary list", () => {
    expect(parseExperimentDesign(design({ primaryMetric: "revenue_per_visitor" })).ok).toBe(false);
  });

  it("rejects a price experiment — pricing is not experimentable in Session 11", () => {
    expect(parseExperimentDesign(design({ experimentType: "PRICE_EXPERIMENT" })).ok).toBe(false);
  });

  it("rejects a variant config carrying markup", () => {
    const result = parseExperimentDesign(
      design({ variantConfig: { message: "<b>Fast shipping</b>", placement: "above_cta" } }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects unknown top-level design keys", () => {
    expect(parseExperimentDesign(design({ renderComponent: "app/page.tsx" })).ok).toBe(false);
  });

  it("applies the traffic ceiling when one is supplied", () => {
    const result = parseExperimentDesign(design(), { maxNonControlPct: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exceeds the maximum experiment traffic share/);
  });

  it('refuses "control" as a variant key', () => {
    expect(parseExperimentDesign(design({ variantKey: "control" })).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Lifecycle (spec §2, §33, §43)                                       */
/* ------------------------------------------------------------------ */

describe("lifecycle transitions", () => {
  it("allows draft → running and running → stopped", () => {
    expect(canTransition("draft", "running").ok).toBe(true);
    expect(canTransition("running", "stopped").ok).toBe(true);
  });

  it("treats a repeated transition as an idempotent no-op", () => {
    const result = canTransition("running", "running");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.noop).toBe(true);
  });

  it("refuses to relaunch a stopped experiment or archive a running one", () => {
    expect(canTransition("stopped", "running").ok).toBe(false);
    expect(canTransition("running", "archived").ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { PRODUCTS } from "@/config/products";
import {
  applyConfigurationPatch,
  defaultConfiguration,
  describeConfiguration,
  validateFullConfiguration,
} from "@/lib/configuration/validation";
import {
  configurationReducer,
  initialConfigurationState,
  type ConfigurationAction,
  type ConfigurationState,
} from "@/lib/configuration/store";

/**
 * Session 06 — shared configuration domain tests (framework-free).
 * The validation module and reducer are THE configuration authority for
 * both the visual configurator and the AI tools; these tests pin the rules.
 */

const product = PRODUCTS[0]; // hero product: 4 sizes, 2 materials, 7 colors (1 custom), 3 print options

const run = (state: ConfigurationState, ...actions: ConfigurationAction[]): ConfigurationState =>
  actions.reduce((s, a) => configurationReducer(product, s, a), state);

describe("defaultConfiguration", () => {
  it("matches the configurator UI's historical defaults", () => {
    const config = defaultConfiguration(product);
    expect(config).toEqual({
      productId: product.id,
      sizeId: product.sizes[0].id,
      materialId: product.materials[0].id,
      colorId: product.colors[0].id,
      printOptionId: "one-color",
      quantity: product.quantityPresets[1],
      artwork: null,
    });
  });
});

describe("applyConfigurationPatch — catalog validation", () => {
  const base = defaultConfiguration(product);

  it("applies a valid multi-field patch and reports changed fields", () => {
    const result = applyConfigurationPatch(product, base, { colorId: "black", quantity: 5000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.colorId).toBe("black");
      expect(result.config.quantity).toBe(5000);
      expect(result.changedFields.sort()).toEqual(["colorId", "quantity"]);
    }
  });

  it("preserves untouched fields verbatim (partial patch semantics)", () => {
    const custom = { ...base, sizeId: "l", printOptionId: "two-color" as const, quantity: 10_000 };
    const result = applyConfigurationPatch(product, custom, { colorId: "navy" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.sizeId).toBe("l");
      expect(result.config.printOptionId).toBe("two-color");
      expect(result.config.quantity).toBe(10_000);
      expect(result.changedFields).toEqual(["colorId"]);
    }
  });

  it("rejects unsupported options with the available alternatives", () => {
    const result = applyConfigurationPatch(product, base, { colorId: "purple" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({ field: "colorId", requested: "purple", reason: "unsupported_option" });
      expect(result.issues[0].available).toContain("black");
      expect(result.issues[0].available).toContain("white");
      expect(result.issues[0].available).not.toContain("purple");
    }
  });

  it("is all-or-nothing: one invalid field rejects the whole patch", () => {
    const result = applyConfigurationPatch(product, base, { colorId: "black", sizeId: "xxl" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.field)).toEqual(["sizeId"]);
    }
  });

  it("rejects non-integer, zero, negative, and over-cap quantities", () => {
    for (const quantity of [0, -100, 2.5, 1_000_001]) {
      const result = applyConfigurationPatch(product, base, { quantity });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]).toMatchObject({ field: "quantity", reason: "invalid_quantity" });
    }
  });

  it("allows below-MOQ quantities as legal state (custom-quote routing, matching the UI)", () => {
    const result = applyConfigurationPatch(product, base, { quantity: 100 });
    expect(result.ok).toBe(true);
  });

  it("allows the custom color (quoted individually, matching the UI)", () => {
    const result = applyConfigurationPatch(product, base, { colorId: "custom" });
    expect(result.ok).toBe(true);
  });

  it("collects ALL invalid fields in one rejection", () => {
    const result = applyConfigurationPatch(product, base, {
      colorId: "purple",
      materialId: "titanium",
      quantity: -1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.field).sort()).toEqual(["colorId", "materialId", "quantity"]);
  });
});

describe("validateFullConfiguration — the UI-sync path", () => {
  it("accepts a legal full configuration and preserves artwork", () => {
    const artwork = { fileName: "logo.png", fileType: "image/png", fileSizeBytes: 1000 };
    const result = validateFullConfiguration(product, {
      ...defaultConfiguration(product),
      colorId: "kraft",
      artwork,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.artwork).toEqual(artwork);
  });

  it("rejects unknown option ids even via the full-config path (no bypass around patch validation)", () => {
    const result = validateFullConfiguration(product, {
      ...defaultConfiguration(product),
      materialId: "does-not-exist",
    });
    expect(result.ok).toBe(false);
  });
});

describe("configurationReducer — user actions", () => {
  it("SET_* actions update config, mark fields dirty, and record the change", () => {
    let state = initialConfigurationState(product);
    state = run(state, { type: "SET_COLOR", colorId: "black" }, { type: "SET_QUANTITY", quantity: 5000 });
    expect(state.config.colorId).toBe("black");
    expect(state.config.quantity).toBe(5000);
    expect(state.dirtyFields.sort()).toEqual(["colorId", "quantity"]);
    expect(state.lastChange).toEqual({ source: "user", fields: ["quantity"] });
  });

  it("ignores illegal values instead of corrupting state", () => {
    const initial = initialConfigurationState(product);
    const state = run(initial, { type: "SET_COLOR", colorId: "purple" });
    expect(state).toBe(initial);
  });

  it("no-ops when the value does not change", () => {
    const initial = initialConfigurationState(product);
    const state = run(initial, { type: "SET_SIZE", sizeId: initial.config.sizeId });
    expect(state).toBe(initial);
  });

  it("SET_ARTWORK tracks artwork dirtiness", () => {
    const artwork = { fileName: "logo.svg", fileType: "image/svg+xml", fileSizeBytes: 500 };
    const state = run(initialConfigurationState(product), { type: "SET_ARTWORK", artwork });
    expect(state.config.artwork).toEqual(artwork);
    expect(state.dirtyFields).toEqual(["artwork"]);
  });
});

describe("configurationReducer — server loads (AI + restore)", () => {
  const serverConfig = (overrides: Partial<ReturnType<typeof defaultConfiguration>>) => ({
    ...defaultConfiguration(product),
    ...overrides,
  });

  it("applies an AI update with a newer revision and flags the changed fields", () => {
    let state = initialConfigurationState(product);
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: serverConfig({ colorId: "black", quantity: 10_000 }),
      revision: 3,
      source: "ai",
    });
    expect(state.config.colorId).toBe("black");
    expect(state.config.quantity).toBe(10_000);
    expect(state.revision).toBe(3);
    expect(state.lastChange).toMatchObject({ source: "ai" });
    expect(state.lastChange?.fields.sort()).toEqual(["colorId", "quantity"]);
  });

  it("ignores stale revisions (an in-flight AI turn cannot roll back newer state)", () => {
    let state = initialConfigurationState(product);
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: serverConfig({ colorId: "black" }),
      revision: 5,
      source: "ai",
    });
    const before = state;
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: serverConfig({ colorId: "red" }),
      revision: 4,
      source: "ai",
    });
    expect(state).toBe(before);
  });

  it("ignores configurations for a different product", () => {
    const initial = initialConfigurationState(product);
    const state = run(initial, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: { ...defaultConfiguration(product), productId: "p-other" },
      revision: 9,
      source: "ai",
    });
    expect(state).toBe(initial);
  });

  it("locally dirty fields win over a concurrent AI update (field-level merge)", () => {
    let state = initialConfigurationState(product);
    // User clicks Navy — not yet synced (dirty).
    state = run(state, { type: "SET_COLOR", colorId: "navy" });
    // AI turn (started earlier) lands: black + 10k at revision 2.
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: serverConfig({ colorId: "black", quantity: 10_000 }),
      revision: 2,
      source: "ai",
    });
    expect(state.config.colorId).toBe("navy"); // user's in-flight click survives
    expect(state.config.quantity).toBe(10_000); // AI's quantity applies
    expect(state.dirtyFields).toContain("colorId"); // will re-assert on next sync
    expect(state.lastChange?.fields).toEqual(["quantity"]);
  });

  it("keeps local artwork on AI loads (artwork only comes from the uploader)", () => {
    const artwork = { fileName: "logo.png", fileType: "image/png", fileSizeBytes: 1234 };
    let state = initialConfigurationState(product);
    state = run(state, { type: "SET_ARTWORK", artwork });
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: serverConfig({ colorId: "black" }),
      revision: 2,
      source: "ai",
    });
    expect(state.config.artwork).toEqual(artwork);
  });

  it("restore loads apply without an 'ai' change marker", () => {
    let state = initialConfigurationState(product);
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: serverConfig({ sizeId: "l" }),
      revision: 1,
      source: "load",
    });
    expect(state.config.sizeId).toBe("l");
    expect(state.lastChange?.source).toBe("load");
  });
});

describe("configurationReducer — sync acknowledgement", () => {
  it("clears only fields whose value still matches what was synced", () => {
    let state = initialConfigurationState(product);
    state = run(state, { type: "SET_COLOR", colorId: "black" }, { type: "SET_QUANTITY", quantity: 5000 });
    const syncedSnapshot = state.config;
    // Mid-flight, the user bumps quantity again.
    state = run(state, { type: "SET_QUANTITY", quantity: 10_000 });
    state = run(state, { type: "SYNC_ACKNOWLEDGED", revision: 2, syncedConfig: syncedSnapshot });
    expect(state.revision).toBe(2);
    expect(state.dirtyFields).toEqual(["quantity"]); // color clean, quantity re-dirty
  });

  it("never lowers the revision", () => {
    let state = initialConfigurationState(product);
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: defaultConfiguration(product),
      revision: 7,
      source: "load",
    });
    state = run(state, { type: "SYNC_ACKNOWLEDGED", revision: 3, syncedConfig: state.config });
    expect(state.revision).toBe(7);
  });
});

describe("configurationReducer — reset", () => {
  it("returns to catalog defaults, keeps the revision, and marks changed fields dirty", () => {
    let state = initialConfigurationState(product);
    state = run(
      state,
      { type: "SET_COLOR", colorId: "black" },
      { type: "SET_QUANTITY", quantity: 10_000 },
      { type: "SYNC_ACKNOWLEDGED", revision: 3, syncedConfig: state.config },
    );
    state = run(state, { type: "SYNC_ACKNOWLEDGED", revision: 3, syncedConfig: state.config });
    state = run(state, { type: "RESET_CONFIGURATION" });
    expect(state.config).toEqual(defaultConfiguration(product));
    expect(state.revision).toBe(3); // server row still exists at its revision
    expect(state.dirtyFields).toEqual(expect.arrayContaining(["colorId", "quantity"])); // reset syncs back
    expect(state.lastChange?.source).toBe("reset");
  });
});

describe("describeConfiguration", () => {
  it("labels every option and reports artwork state", () => {
    const config = { ...defaultConfiguration(product), colorId: "black", quantity: 5000 };
    const d = describeConfiguration(product, config);
    expect(d.color).toEqual({ id: "black", label: "Black", custom: false });
    expect(d.printOption.requiresArtwork).toBe(true);
    expect(d.hasArtwork).toBe(false);
    expect(d.quantity).toBe(5000);
    expect(d.productTitle).toBe(product.title);
  });
});

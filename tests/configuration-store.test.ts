import { describe, expect, it } from "vitest";
import { PRODUCTS } from "@/config/products";
import {
  applyConfigurationPatch,
  defaultConfiguration,
  describeConfiguration,
  reconcileConfiguration,
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

/**
 * The launch product: 2 sizes, 1 fixed material, 2 colors, 1 print option,
 * 2 orderable quantities. Deliberately narrow — that narrowness is the
 * thing the reducer and validator now have to enforce.
 */
const product = PRODUCTS[0];
/** A launch-disabled catalog entry, for the wider option space (custom color). */
const wideProduct = PRODUCTS.find((p) => p.colors.some((c) => c.custom))!;

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
      printOptionId: product.printOptions[0].id,
      quantity: product.quantityPresets[1],
      artwork: null,
    });
  });
});

describe("applyConfigurationPatch — catalog validation", () => {
  const base = defaultConfiguration(product);

  it("applies a valid multi-field patch and reports changed fields", () => {
    const result = applyConfigurationPatch(product, base, { colorId: "white", quantity: 5000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.colorId).toBe("white");
      expect(result.config.quantity).toBe(5000);
      expect(result.changedFields.sort()).toEqual(["colorId", "quantity"]);
    }
  });

  it("preserves untouched fields verbatim (partial patch semantics)", () => {
    const custom = { ...base, sizeId: "xl", quantity: 10_000 };
    const result = applyConfigurationPatch(product, custom, { colorId: "white" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.sizeId).toBe("xl");
      expect(result.config.printOptionId).toBe(base.printOptionId);
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

  it("allows the custom color on a product that offers one (quoted individually, matching the UI)", () => {
    const wideBase = defaultConfiguration(wideProduct);
    const result = applyConfigurationPatch(wideProduct, wideBase, { colorId: "custom" });
    expect(result.ok).toBe(true);
  });

  it("rejects a color the launch product does not offer, even though another catalog entry has it", () => {
    expect(wideProduct.colors.some((c) => c.id === "kraft")).toBe(true);
    expect(applyConfigurationPatch(product, base, { colorId: "kraft" }).ok).toBe(false);
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
      colorId: "white",
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
    state = run(state, { type: "SET_COLOR", colorId: "white" }, { type: "SET_QUANTITY", quantity: 5000 });
    expect(state.config.colorId).toBe("white");
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
    const artwork = { fileName: "logo.pdf", fileType: "application/pdf", fileSizeBytes: 500 };
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
      config: serverConfig({ colorId: "white", quantity: 5000 }),
      revision: 3,
      source: "ai",
    });
    expect(state.config.colorId).toBe("white");
    expect(state.config.quantity).toBe(5000);
    expect(state.revision).toBe(3);
    expect(state.lastChange).toMatchObject({ source: "ai" });
    expect(state.lastChange?.fields.sort()).toEqual(["colorId", "quantity"]);
  });

  it("ignores stale revisions (an in-flight AI turn cannot roll back newer state)", () => {
    let state = initialConfigurationState(product);
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: serverConfig({ colorId: "white" }),
      revision: 5,
      source: "ai",
    });
    const before = state;
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: serverConfig({ colorId: "black" }),
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
    // User clicks White — not yet synced (dirty).
    state = run(state, { type: "SET_COLOR", colorId: "white" });
    // AI turn (started earlier) lands: black + 10k at revision 2.
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: serverConfig({ colorId: "black", quantity: 5000 }),
      revision: 2,
      source: "ai",
    });
    expect(state.config.colorId).toBe("white"); // user's in-flight click survives
    expect(state.config.quantity).toBe(5000); // AI's quantity applies
    expect(state.dirtyFields).toContain("colorId"); // will re-assert on next sync
    expect(state.lastChange?.fields).toEqual(["quantity"]);
  });

  it("keeps local artwork on AI loads (artwork only comes from the uploader)", () => {
    const artwork = { fileName: "logo.png", fileType: "image/png", fileSizeBytes: 1234 };
    let state = initialConfigurationState(product);
    state = run(state, { type: "SET_ARTWORK", artwork });
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: serverConfig({ colorId: "white" }),
      revision: 2,
      source: "ai",
    });
    expect(state.config.artwork).toEqual(artwork);
  });

  it("restore loads apply without an 'ai' change marker", () => {
    let state = initialConfigurationState(product);
    state = run(state, {
      type: "LOAD_SERVER_CONFIGURATION",
      config: serverConfig({ sizeId: "xl" }),
      revision: 1,
      source: "load",
    });
    expect(state.config.sizeId).toBe("xl");
    expect(state.lastChange?.source).toBe("load");
  });
});

describe("configurationReducer — sync acknowledgement", () => {
  it("clears only fields whose value still matches what was synced", () => {
    let state = initialConfigurationState(product);
    state = run(state, { type: "SET_COLOR", colorId: "white" }, { type: "SET_QUANTITY", quantity: 5000 });
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
      { type: "SET_COLOR", colorId: "white" },
      { type: "SET_QUANTITY", quantity: 5000 },
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

/**
 * A persisted configuration outlives the catalog that produced it. Product #1
 * replaced the seed catalog's sizes, material, colors and print options, so
 * every row written before it names ids this product no longer offers.
 */
describe("reconcileConfiguration — a stored row meets a changed catalog", () => {
  const stale = {
    productId: product.id,
    sizeId: "m",
    materialId: "standard",
    colorId: "kraft",
    printOptionId: "one-color" as const,
    quantity: 1_000,
    artwork: null,
  };

  it("falls back to catalog defaults for every retired option, and reports them", () => {
    const { config, resetFields } = reconcileConfiguration(product, stale);
    const defaults = defaultConfiguration(product);
    expect(config.sizeId).toBe(defaults.sizeId);
    expect(config.materialId).toBe(defaults.materialId);
    expect(config.colorId).toBe(defaults.colorId);
    expect(config.printOptionId).toBe(defaults.printOptionId);
    expect(resetFields.sort()).toEqual(["colorId", "materialId", "printOptionId", "sizeId"]);
  });

  it("leaves a still-legal configuration completely untouched", () => {
    const current = { ...defaultConfiguration(product), sizeId: "xl", colorId: "white", quantity: 10_000 };
    const { config, resetFields } = reconcileConfiguration(product, current);
    expect(config).toEqual(current);
    expect(resetFields).toEqual([]);
  });

  it("keeps a below-MOQ quantity — that is a legal quote state, not a stale id", () => {
    const { config, resetFields } = reconcileConfiguration(product, { ...stale, quantity: 300 });
    expect(config.quantity).toBe(300);
    expect(resetFields).not.toContain("quantity");
  });

  it("the reconciled configuration is one the catalog can actually render", () => {
    const { config } = reconcileConfiguration(product, stale);
    // The print option resolves, so artwork is required again and the
    // configurator cannot silently drop the rule.
    const print = product.printOptions.find((o) => o.id === config.printOptionId);
    expect(print).toBeDefined();
    expect(print!.requiresArtwork).toBe(true);
    expect(validateFullConfiguration(product, config).ok).toBe(true);
  });

  it("preserves artwork — it belongs to the customer, not to the catalog", () => {
    const artwork = { artworkId: "art_1", fileName: "logo.png", fileType: "image/png", fileSizeBytes: 10 };
    const { config } = reconcileConfiguration(product, { ...stale, artwork });
    expect(config.artwork).toEqual(artwork);
  });
});

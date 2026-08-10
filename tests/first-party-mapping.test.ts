import { describe, expect, it } from "vitest";
import { mapAnalyticsEvent } from "@/lib/analytics/first-party";

/**
 * The GA4-name → platform-taxonomy mapping table (pure, no DB). The
 * dataLayer keeps its GA4 names; these mappings are what lands first-party.
 */
describe("GA4 → platform event mapping", () => {
  it("maps the funnel to platform taxonomy names", () => {
    expect(mapAnalyticsEvent({ name: "page_view", params: { page_path: "/products" } })).toEqual({
      name: "page_view",
      page: "/products",
    });
    expect(
      mapAnalyticsEvent({
        name: "view_item",
        params: { items: [{ product_id: "p-1", product_name: "Bag" }], currency: "USD" },
      }),
    ).toEqual({ name: "product_viewed", productId: "p-1" });
    expect(mapAnalyticsEvent({ name: "product_config_started", params: { product_id: "p-1" } })).toEqual({
      name: "configurator_started",
      productId: "p-1",
    });
    expect(mapAnalyticsEvent({ name: "select_size", params: { product_id: "p-1", size: "Medium" } })).toEqual({
      name: "configurator_updated",
      productId: "p-1",
      props: { option: "size", value: "Medium" },
    });
    expect(mapAnalyticsEvent({ name: "select_quantity", params: { product_id: "p-1", quantity: 5000 } })).toEqual({
      name: "quantity_selected",
      productId: "p-1",
      props: { quantity: 5000 },
    });
    expect(
      mapAnalyticsEvent({
        name: "begin_checkout",
        params: { items: [{ product_id: "p-1", product_name: "Bag" }], value: 2100, currency: "USD" },
      }),
    ).toEqual({ name: "checkout_started", props: { value: 2100, currency: "USD", lines: 1 } });
  });

  it("maps both quote entry points to quote_started with distinct triggers", () => {
    expect(mapAnalyticsEvent({ name: "request_custom_quote", params: { product_id: "p-1" } })).toEqual({
      name: "quote_started",
      productId: "p-1",
      props: { trigger: "configurator" },
    });
    expect(mapAnalyticsEvent({ name: "quote_form_started" })).toEqual({
      name: "quote_started",
      props: { trigger: "form" },
    });
    expect(mapAnalyticsEvent({ name: "quote_form_submitted" })).toEqual({ name: "quote_submitted" });
  });

  it("keeps purchase server-authoritative and low-value events dataLayer-only", () => {
    expect(
      mapAnalyticsEvent({
        name: "purchase",
        params: { transaction_id: "MOCK-1", items: [], value: 2100, currency: "USD" },
      }),
    ).toBeNull();
    expect(mapAnalyticsEvent({ name: "view_cart", params: { items: [], value: 0, currency: "USD" } })).toBeNull();
    expect(mapAnalyticsEvent({ name: "select_item", params: { items: [] } })).toBeNull();
    expect(mapAnalyticsEvent({ name: "add_shipping_info", params: {} })).toBeNull();
  });
});

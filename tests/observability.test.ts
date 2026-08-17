import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { correlationIdFrom, CORRELATION_HEADER, newCorrelationId } from "@/lib/observability/correlation";
import {
  captureException,
  describeErrorTrackingReadiness,
  parseSentryDsn,
  __errorTrackingDeliveryForTests,
  __resetErrorTrackingForTests,
} from "@/lib/observability/error-tracking";
import { describeError, logEvent, redactText, REDACTED } from "@/lib/observability/logger";

/**
 * Production Launch Session 03 §34–§37 — structured logging, correlation
 * and error tracking.
 *
 * The property that matters most: NOTHING here can leak a credential, not
 * even one that arrived inside a provider's own error message — which is
 * where they actually leak from in practice.
 */

const captured: { stream: string; line: string }[] = [];

beforeEach(() => {
  captured.length = 0;
  __resetErrorTrackingForTests();
  delete process.env.SENTRY_DSN;
  delete process.env.ERROR_WEBHOOK_URL;
  for (const stream of ["log", "warn", "error"] as const) {
    vi.spyOn(console, stream).mockImplementation((line: unknown) => {
      captured.push({ stream, line: String(line) });
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SENTRY_DSN;
  delete process.env.ERROR_WEBHOOK_URL;
});

/* ------------------------------------------------------------------ */

describe("structured logging (§34)", () => {
  it("emits one JSON line with the required fields", () => {
    logEvent({ subsystem: "checkout", event: "checkout_created", severity: "info", correlationId: "req_abc", orderId: "ord_1" });
    const parsed = JSON.parse(captured[0].line);
    expect(parsed.subsystem).toBe("checkout");
    expect(parsed.event).toBe("checkout_created");
    expect(parsed.severity).toBe("info");
    expect(parsed.correlationId).toBe("req_abc");
    expect(parsed.orderId).toBe("ord_1");
    expect(typeof parsed.at).toBe("string");
  });

  it("routes severity to the right console stream, so a platform log drain can filter", () => {
    logEvent({ subsystem: "commerce", event: "a", severity: "info" });
    logEvent({ subsystem: "commerce", event: "b", severity: "warn" });
    logEvent({ subsystem: "commerce", event: "c", severity: "error" });
    expect(captured.map((c) => c.stream)).toEqual(["log", "warn", "error"]);
  });

  it("never breaks a request, whatever it is handed", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      logEvent({ subsystem: "checkout", event: "weird", value: circular as unknown as string }),
    ).not.toThrow();
  });
});

describe("redaction is a backstop that actually works (§34)", () => {
  it("redacts a field whose NAME looks like a secret", () => {
    logEvent({ subsystem: "commerce", event: "x", adminToken: "value-should-not-appear" });
    expect(captured[0].line).not.toContain("value-should-not-appear");
    expect(captured[0].line).toContain(REDACTED);
  });

  it("redacts credential SHAPES inside free text nobody wrote by hand", () => {
    const shopify = redactText("Shopify said: invalid token shpat_abcdef1234567890 for shop");
    expect(shopify).not.toContain("shpat_abcdef1234567890");
    expect(shopify).toContain(REDACTED);

    const bearer = redactText("Authorization: Bearer abcdefghijklmnop1234567890");
    expect(bearer).not.toContain("abcdefghijklmnop1234567890");

    const anthropic = redactText("key sk-ant-api03-abcdefghijklmnop rejected");
    expect(anthropic).not.toContain("sk-ant-api03-abcdefghijklmnop");
  });

  it("redacts a credential embedded in an Error message", () => {
    const described = describeError(new Error("PUT https://bucket.s3.example/o?X-Amz-Credential=x failed: Bearer abcdefghijklmnop1234"));
    expect(described).not.toContain("abcdefghijklmnop1234");
  });

  it("leaves ordinary operational values alone", () => {
    logEvent({ subsystem: "checkout", event: "x", orderId: "ord_1234", totalCents: 210_000 });
    expect(captured[0].line).toContain("ord_1234");
    expect(captured[0].line).toContain("210000");
  });
});

describe("correlation ids (§35)", () => {
  it("mints a bounded, opaque id", () => {
    const id = newCorrelationId();
    expect(id).toMatch(/^req_[0-9a-f]{20}$/);
  });

  it("accepts a plausible caller-supplied id and rejects a hostile one", () => {
    const supplied = correlationIdFrom({ headers: { get: () => "req_abcdef123456" } });
    expect(supplied).toBe("req_abcdef123456");

    const hostile = correlationIdFrom({
      headers: { get: () => '"><script>alert(1)</script>' },
    });
    expect(hostile).toMatch(/^req_/);
    expect(hostile).not.toContain("script");
  });

  it("uses the header every common proxy already passes through", () => {
    expect(CORRELATION_HEADER).toBe("x-request-id");
  });
});

describe("error tracking works unconfigured (§36)", () => {
  it("reports nothing configured, and still writes the structured log line", () => {
    expect(describeErrorTrackingReadiness()).toEqual({ configured: false, destinations: [], error: null });
    captureException(new Error("boom"), { subsystem: "checkout", event: "test_failure", code: "TEST" });
    const parsed = JSON.parse(captured.at(-1)!.line);
    expect(parsed.subsystem).toBe("checkout");
    expect(parsed.severity).toBe("error");
    expect(parsed.code).toBe("TEST");
  });

  it("parses a valid DSN and rejects garbage", () => {
    expect(parseSentryDsn("https://abc123@o1.ingest.sentry.io/42")).toEqual({
      origin: "https://o1.ingest.sentry.io",
      projectId: "42",
      publicKey: "abc123",
    });
    expect(parseSentryDsn("nonsense")).toBeNull();
    expect(parseSentryDsn("https://o1.ingest.sentry.io/42")).toBeNull();
  });

  it("reports a malformed DSN rather than silently dropping every error", () => {
    process.env.SENTRY_DSN = "nonsense";
    const readiness = describeErrorTrackingReadiness();
    expect(readiness.configured).toBe(false);
    expect(readiness.error).toMatch(/not a valid DSN/);
  });

  it("delivers to a configured webhook without a credential in the payload", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example/errors";
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    captureException(new Error("Shopify rejected token shpat_abcdef1234567890"), {
      subsystem: "checkout",
      event: "shopify_checkout_failed",
      correlationId: "req_xyz",
      code: "PROVIDER_ERROR",
    });
    await __errorTrackingDeliveryForTests();
    globalThis.fetch = originalFetch;

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain("shpat_abcdef1234567890");
    expect(bodies[0]).toContain("req_xyz");
    expect(bodies[0]).toContain("shopify_checkout_failed");
  });

  it("a monitoring outage cannot fail the request it is monitoring (§10, §37)", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example/errors";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("monitoring is down");
    }) as unknown as typeof fetch;

    expect(() =>
      captureException(new Error("original failure"), { subsystem: "checkout", event: "x", code: "Y" }),
    ).not.toThrow();
    await __errorTrackingDeliveryForTests();
    globalThis.fetch = originalFetch;
  });

  it("caps an error storm instead of turning it into a request storm", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example/errors";
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    for (let i = 0; i < 200; i += 1) {
      captureException(new Error(`failure ${i}`), { subsystem: "db", event: "storm", code: "DB" });
    }
    await __errorTrackingDeliveryForTests();
    globalThis.fetch = originalFetch;

    expect(calls).toBeLessThanOrEqual(60);
    // Every one of them still reached the structured log.
    expect(captured.filter((c) => c.line.includes('"event":"storm"')).length).toBe(200);
  });
});

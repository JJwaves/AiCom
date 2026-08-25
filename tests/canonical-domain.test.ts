import { afterEach, beforeEach, describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { PLACEHOLDER_DOMAIN, siteDomain, siteUrl } from "@/config/site";
import { resetDb } from "./db-helpers";

/**
 * Production Launch Session 04 §9 — no `example.com` may reach production
 * output.
 *
 * The rule (config/site.ts): with NEXT_PUBLIC_SITE_DOMAIN unconfigured there
 * is no honest canonical host, so no surface fabricates a URL. The
 * placeholder exists ONLY so `next build` keeps working while owner
 * configuration is missing.
 *
 * The bug this closes: robots.ts implemented the rule and sitemap.ts did
 * not. With the domain unset, `GET /sitemap.xml` answered 200 with 20+ URLs
 * on `https://example.com` — pages on a domain the owner does not own,
 * servable to anything that fetches the path directly or submits it to
 * Search Console. robots.txt's `Disallow: /` does not prevent either.
 */

const saved = { domain: process.env.NEXT_PUBLIC_SITE_DOMAIN };

beforeEach(async () => {
  await resetDb();
  delete process.env.NEXT_PUBLIC_SITE_DOMAIN;
});

afterEach(() => {
  if (saved.domain === undefined) delete process.env.NEXT_PUBLIC_SITE_DOMAIN;
  else process.env.NEXT_PUBLIC_SITE_DOMAIN = saved.domain;
});

describe("with no domain configured, nothing fabricates a URL", () => {
  it("reports the domain as unknown rather than guessing", () => {
    expect(siteDomain()).toBeNull();
    expect(siteUrl()).toBeNull();
  });

  it("serves an EMPTY sitemap instead of indexing the placeholder domain", async () => {
    const entries = await sitemap();
    expect(entries).toEqual([]);
  });

  it("refuses crawling entirely in robots.txt", () => {
    const result = robots();
    expect(result.sitemap).toBeUndefined();
    expect(result.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
  });

  it("treats the placeholder domain as unconfigured even when set explicitly", async () => {
    process.env.NEXT_PUBLIC_SITE_DOMAIN = PLACEHOLDER_DOMAIN;
    expect(siteDomain()).toBeNull();
    expect(await sitemap()).toEqual([]);
  });
});

describe("with a real domain configured, every surface uses it", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_DOMAIN = "bagdirect-example-store.com";
  });

  it("publishes a sitemap, all on the configured host", async () => {
    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.url.startsWith("https://bagdirect-example-store.com")).toBe(true);
      expect(entry.url).not.toContain(PLACEHOLDER_DOMAIN);
    }
  });

  it("advertises the sitemap from robots.txt", () => {
    const result = robots();
    expect(result.sitemap).toBe("https://bagdirect-example-store.com/sitemap.xml");
  });
});

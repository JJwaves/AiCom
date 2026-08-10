import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST } from "@/app/api/events/route";
import { getDb } from "@/db/client";
import { events, sessions } from "@/db/schema";
import { newId } from "@/lib/data/id";
import { resetDb } from "./db-helpers";

const makeRequest = (body: unknown, cookie?: string): Request =>
  new Request("http://localhost/api/events", {
    method: "POST",
    // No JSON content-type on purpose — sendBeacon posts text/plain.
    headers: cookie ? { cookie } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const pageView = () => ({
  name: "page_view",
  clientEventId: newId("evt"),
  occurredAt: new Date().toISOString(),
  page: "/",
  props: {},
});

describe("POST /api/events", () => {
  beforeEach(resetDb);

  it("mints a session, stores events + attribution, and sets identity cookies", async () => {
    const res = await POST(
      makeRequest({
        events: [pageView()],
        attribution: {
          first: { params: { utm_source: "google" }, landing_page: "/lp/a", referrer: "", ts: "t" },
          last: { params: { utm_source: "google" }, landing_page: "/lp/a", referrer: "", ts: "t" },
        },
      }),
    );
    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("bd_sid=sess_") && c.includes("HttpOnly"))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("bd_aid=anon_"))).toBe(true);

    const db = await getDb();
    const sessionRows = await db.select().from(sessions);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0].firstTouchJson?.params.utm_source).toBe("google");
    const names = (await db.select().from(events)).map((e) => e.name).sort();
    expect(names).toEqual(["page_view", "session_started"]);
  });

  it("reuses the cookie session on subsequent batches", async () => {
    const first = await POST(makeRequest({ events: [pageView()] }));
    const sid = first.headers
      .getSetCookie()
      .find((c) => c.startsWith("bd_sid="))!
      .split(";")[0];

    const second = await POST(makeRequest({ events: [pageView()] }, sid));
    expect(second.status).toBe(200);
    const db = await getDb();
    expect(await db.select().from(sessions)).toHaveLength(1);
    expect(await db.select().from(events).where(eq(events.name, "session_started"))).toHaveLength(1);
  });

  it("strips unknown attribution params and never overwrites first touch", async () => {
    const first = await POST(
      makeRequest({
        events: [pageView()],
        attribution: {
          first: { params: { utm_source: "google", evil: "1" }, landing_page: "/", referrer: "", ts: "t" },
          last: { params: { utm_source: "google" }, landing_page: "/", referrer: "", ts: "t" },
        },
      }),
    );
    const sid = first.headers.getSetCookie().find((c) => c.startsWith("bd_sid="))!.split(";")[0];

    await POST(
      makeRequest(
        {
          events: [pageView()],
          attribution: {
            first: { params: { utm_source: "OVERWRITE" }, landing_page: "/x", referrer: "", ts: "t2" },
            last: { params: { fbclid: "f1" }, landing_page: "/x", referrer: "", ts: "t2" },
          },
        },
        sid,
      ),
    );

    const db = await getDb();
    const [session] = await db.select().from(sessions);
    expect(session.firstTouchJson?.params.utm_source).toBe("google"); // immutable
    expect(session.firstTouchJson?.params).not.toHaveProperty("evil"); // stripped
    expect(session.lastTouchJson?.params.fbclid).toBe("f1");
  });

  it("rejects malformed, invalid, and oversized payloads", async () => {
    expect((await POST(makeRequest("{not json"))).status).toBe(400);
    expect((await POST(makeRequest({ events: [] }))).status).toBe(422);
    expect((await POST(makeRequest({ events: [{ ...pageView(), name: "nope" }] }))).status).toBe(422);
    const huge = makeRequest(JSON.stringify({ events: [pageView()], pad: "x".repeat(70_000) }));
    expect((await POST(huge)).status).toBe(413);

    const db = await getDb();
    expect(await db.select().from(sessions)).toHaveLength(0); // rejected requests mint nothing
  });
});

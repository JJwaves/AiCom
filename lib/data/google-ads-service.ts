import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { GOOGLE_ADS } from "@/config/google-ads";
import { getDb } from "@/db/client";
import { adAccounts, adCampaignDailyMetrics, googleAdsSyncRuns } from "@/db/schema";
import { newId } from "./id";

/**
 * Google Ads persistence (Session 13 spec §10, §12, §44–§46).
 *
 * The ONLY place the three Session-13 tables are read or written. Nothing
 * here calls the Google Ads API — the adapter (`lib/google-ads`) fetches,
 * this module stores, and `modules/google-ads-intelligence` reads. That
 * separation is what makes the admin dashboard independent of the API
 * (spec §10): a page render touches this module and never the network.
 *
 * Two properties are enforced here rather than hoped for:
 *
 *  IDEMPOTENCY (spec §44) — `upsertCampaignDailyMetrics` writes on the
 *  natural key (account, campaign, day). Syncing the same range twice cannot
 *  double spend, because the second write UPDATES the same row.
 *
 *  RESTATEMENT, NOT APPEND (spec §45) — Google revises recent days as
 *  delayed conversions arrive. The upsert overwrites those days in place, so
 *  a restated day corrects itself instead of adding a second version that
 *  would inflate the period total.
 *
 * NO CREDENTIAL IS EVER WRITTEN by any function in this file.
 */

export type AdAccountRow = typeof adAccounts.$inferSelect;
export type AdCampaignDailyRow = typeof adCampaignDailyMetrics.$inferSelect;
export type SyncRunRow = typeof googleAdsSyncRuns.$inferSelect;

export const GOOGLE_ADS_PLATFORM = "google_ads";

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

const accountInputSchema = z.object({
  platform: z.string().min(1).max(40),
  externalAccountId: z.string().min(1).max(40),
  descriptiveName: z.string().max(300).nullable().optional(),
  currencyCode: z.string().min(3).max(10),
  timeZone: z.string().min(1).max(80),
  isManager: z.boolean().default(false),
  isTestAccount: z.boolean().default(false),
  loginCustomerId: z.string().max(40).nullable().optional(),
  apiVersion: z.string().max(20).nullable().optional(),
});

/**
 * Record (or refresh) the connected account.
 *
 * Currency and time zone are refreshed on every connection check because
 * they are settings an owner can change in Google Ads, and a stale copy
 * would silently mis-scale money or shift day boundaries.
 */
export async function upsertAdAccount(input: z.input<typeof accountInputSchema>): Promise<AdAccountRow> {
  const parsed = accountInputSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(adAccounts)
    .values({
      id: newId("adacc"),
      platform: parsed.platform,
      externalAccountId: parsed.externalAccountId,
      descriptiveName: parsed.descriptiveName ?? null,
      currencyCode: parsed.currencyCode,
      timeZone: parsed.timeZone,
      isManager: parsed.isManager,
      isTestAccount: parsed.isTestAccount,
      loginCustomerId: parsed.loginCustomerId ?? null,
      apiVersion: parsed.apiVersion ?? null,
    })
    .onConflictDoUpdate({
      target: [adAccounts.platform, adAccounts.externalAccountId],
      set: {
        descriptiveName: parsed.descriptiveName ?? null,
        currencyCode: parsed.currencyCode,
        timeZone: parsed.timeZone,
        isManager: parsed.isManager,
        isTestAccount: parsed.isTestAccount,
        loginCustomerId: parsed.loginCustomerId ?? null,
        apiVersion: parsed.apiVersion ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function getAdAccount(
  externalAccountId: string,
  platform = GOOGLE_ADS_PLATFORM,
): Promise<AdAccountRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(adAccounts)
    .where(and(eq(adAccounts.platform, platform), eq(adAccounts.externalAccountId, externalAccountId)))
    .limit(1);
  return row ?? null;
}

/**
 * The single connected Google Ads account, if any.
 *
 * Session 13 is deliberately single-account (spec §7 — no multi-tenant
 * onboarding). More than one row would mean a customer id was changed; the
 * most recently updated one wins and the dashboard shows which.
 */
export async function getConnectedAdAccount(platform = GOOGLE_ADS_PLATFORM): Promise<AdAccountRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(adAccounts)
    .where(eq(adAccounts.platform, platform))
    .orderBy(desc(adAccounts.updatedAt))
    .limit(1);
  return row ?? null;
}

/** Stamp the last SUCCESSFUL sync. Partial and failed runs never set it. */
export async function markAccountSynced(adAccountId: string, at: Date): Promise<void> {
  const db = await getDb();
  await db
    .update(adAccounts)
    .set({ lastSuccessfulSyncAt: at, updatedAt: new Date() })
    .where(eq(adAccounts.id, adAccountId));
}

/* ------------------------------------------------------------------ */
/* Campaign daily metrics                                              */
/* ------------------------------------------------------------------ */

const dailyMetricSchema = z.object({
  campaignId: z.string().min(1).max(120),
  campaignName: z.string().min(1).max(300),
  campaignStatus: z.string().min(1).max(40),
  advertisingChannelType: z.string().max(60).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  costCents: z.number().int().min(0),
  currencyCode: z.string().min(3).max(10),
  googleConversions: z.number().min(0),
  googleConversionValueCents: z.number().int().min(0),
});

export type DailyMetricInput = z.input<typeof dailyMetricSchema>;

export type UpsertResult = { inserted: number; updated: number };

/**
 * Idempotent upsert of campaign × day rows.
 *
 * Insert-vs-update is determined by reading the existing natural keys first
 * rather than by inspecting the write. That costs one bounded SELECT and
 * gives an honest count for the sync audit row — a number the owner uses to
 * tell "Google restated 12 days" from "12 new days arrived".
 */
export async function upsertCampaignDailyMetrics(
  adAccountId: string,
  rows: DailyMetricInput[],
  syncRunId: string | null = null,
): Promise<UpsertResult> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };
  const parsed = rows.map((r) => dailyMetricSchema.parse(r));
  const db = await getDb();

  const dates = [...new Set(parsed.map((r) => r.date))];
  const existing = await db
    .select({ campaignId: adCampaignDailyMetrics.campaignId, date: adCampaignDailyMetrics.date })
    .from(adCampaignDailyMetrics)
    .where(and(eq(adCampaignDailyMetrics.adAccountId, adAccountId), inArray(adCampaignDailyMetrics.date, dates)));
  const existingKeys = new Set(existing.map((r) => `${r.campaignId}|${r.date}`));

  let inserted = 0;
  let updated = 0;
  const now = new Date();

  for (const row of parsed) {
    if (existingKeys.has(`${row.campaignId}|${row.date}`)) updated += 1;
    else inserted += 1;

    await db
      .insert(adCampaignDailyMetrics)
      .values({
        id: newId("adcd"),
        adAccountId,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        campaignStatus: row.campaignStatus,
        advertisingChannelType: row.advertisingChannelType ?? null,
        date: row.date,
        impressions: row.impressions,
        clicks: row.clicks,
        costCents: row.costCents,
        currencyCode: row.currencyCode,
        googleConversions: row.googleConversions,
        googleConversionValueCents: row.googleConversionValueCents,
        lastSyncRunId: syncRunId,
      })
      .onConflictDoUpdate({
        target: [adCampaignDailyMetrics.adAccountId, adCampaignDailyMetrics.campaignId, adCampaignDailyMetrics.date],
        set: {
          // Every metric is REPLACED, never accumulated: Google's row for a
          // day is the whole truth for that day (spec §45).
          campaignName: row.campaignName,
          campaignStatus: row.campaignStatus,
          advertisingChannelType: row.advertisingChannelType ?? null,
          impressions: row.impressions,
          clicks: row.clicks,
          costCents: row.costCents,
          currencyCode: row.currencyCode,
          googleConversions: row.googleConversions,
          googleConversionValueCents: row.googleConversionValueCents,
          lastSyncRunId: syncRunId,
          updatedAt: now,
        },
      });
  }

  return { inserted, updated };
}

/** Campaign × day rows for a reporting window (account-calendar dates). */
export async function listCampaignDailyMetrics(
  adAccountId: string,
  startDate: string,
  endDate: string,
  limit = GOOGLE_ADS.MAX_ROWS_PER_QUERY,
): Promise<AdCampaignDailyRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(adCampaignDailyMetrics)
    .where(
      and(
        eq(adCampaignDailyMetrics.adAccountId, adAccountId),
        gte(adCampaignDailyMetrics.date, startDate),
        lte(adCampaignDailyMetrics.date, endDate),
      ),
    )
    .orderBy(adCampaignDailyMetrics.date)
    .limit(Math.min(limit, GOOGLE_ADS.MAX_ROWS_PER_QUERY));
}

/**
 * The most recent reporting day we hold ANY row for.
 *
 * Distinct from "last sync time": a sync that succeeded an hour ago may
 * still only carry data through yesterday, because Google's own reporting
 * lags. The dashboard shows both (spec §28).
 */
export async function latestMetricDate(adAccountId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ date: sql<string | null>`max(${adCampaignDailyMetrics.date})` })
    .from(adCampaignDailyMetrics)
    .where(eq(adCampaignDailyMetrics.adAccountId, adAccountId));
  return row?.date ?? null;
}

/** Distinct currencies present in a window — the currency-mismatch check. */
export async function listMetricCurrencies(adAccountId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .selectDistinct({ currencyCode: adCampaignDailyMetrics.currencyCode })
    .from(adCampaignDailyMetrics)
    .where(eq(adCampaignDailyMetrics.adAccountId, adAccountId));
  return rows.map((r) => r.currencyCode);
}

/* ------------------------------------------------------------------ */
/* Sync runs                                                           */
/* ------------------------------------------------------------------ */

export const SYNC_STATUSES = ["running", "success", "partial", "failed"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

const startSyncSchema = z.object({
  adAccountId: z.string().max(64).nullable().optional(),
  externalAccountId: z.string().max(40).nullable().optional(),
  apiVersion: z.string().max(20).nullable().optional(),
  requestedStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  triggeredBy: z.string().min(1).max(120),
});

export async function startSyncRun(input: z.input<typeof startSyncSchema>): Promise<SyncRunRow> {
  const parsed = startSyncSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(googleAdsSyncRuns)
    .values({
      id: newId("gasr"),
      adAccountId: parsed.adAccountId ?? null,
      externalAccountId: parsed.externalAccountId ?? null,
      apiVersion: parsed.apiVersion ?? null,
      requestedStartDate: parsed.requestedStartDate,
      requestedEndDate: parsed.requestedEndDate,
      status: "running",
      triggeredBy: parsed.triggeredBy,
      startedAt: new Date(),
    })
    .returning();
  return row;
}

const finishSyncSchema = z.object({
  status: z.enum(SYNC_STATUSES),
  adAccountId: z.string().max(64).nullable().optional(),
  rowsFetched: z.number().int().min(0).default(0),
  rowsInserted: z.number().int().min(0).default(0),
  rowsUpdated: z.number().int().min(0).default(0),
  truncated: z.boolean().default(false),
  errorCode: z.string().max(60).nullable().optional(),
  /** Already redacted by the caller; bounded here as a second line of defense. */
  errorMessage: z.string().max(600).nullable().optional(),
  providerRequestId: z.string().max(120).nullable().optional(),
});

export async function finishSyncRun(
  id: string,
  input: z.input<typeof finishSyncSchema>,
): Promise<SyncRunRow | null> {
  const parsed = finishSyncSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .update(googleAdsSyncRuns)
    .set({
      status: parsed.status,
      adAccountId: parsed.adAccountId ?? undefined,
      rowsFetched: parsed.rowsFetched,
      rowsInserted: parsed.rowsInserted,
      rowsUpdated: parsed.rowsUpdated,
      truncated: parsed.truncated,
      errorCode: parsed.errorCode ?? null,
      errorMessage: parsed.errorMessage ?? null,
      providerRequestId: parsed.providerRequestId ?? null,
      completedAt: new Date(),
    })
    .where(eq(googleAdsSyncRuns.id, id))
    .returning();
  return row ?? null;
}

/** Most recent runs, newest first — the admin sync history. */
export async function listSyncRuns(limit = 20): Promise<SyncRunRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(googleAdsSyncRuns)
    .orderBy(desc(googleAdsSyncRuns.startedAt))
    .limit(Math.min(limit, 100));
}

/**
 * The last run that FULLY succeeded.
 *
 * Freshness is computed from this and only this: a PARTIAL run leaves the
 * data usable but not fresh, and a FAILED run must never refresh the clock
 * (spec §46).
 */
export async function getLastSuccessfulSyncRun(): Promise<SyncRunRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(googleAdsSyncRuns)
    .where(eq(googleAdsSyncRuns.status, "success"))
    .orderBy(desc(googleAdsSyncRuns.startedAt))
    .limit(1);
  return row ?? null;
}

/** The last run of any outcome — how the dashboard reports a failure. */
export async function getLastSyncRun(): Promise<SyncRunRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(googleAdsSyncRuns).orderBy(desc(googleAdsSyncRuns.startedAt)).limit(1);
  return row ?? null;
}

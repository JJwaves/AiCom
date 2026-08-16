CREATE TABLE "ad_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"external_account_id" text NOT NULL,
	"descriptive_name" text,
	"currency_code" text NOT NULL,
	"time_zone" text NOT NULL,
	"is_manager" boolean DEFAULT false NOT NULL,
	"is_test_account" boolean DEFAULT false NOT NULL,
	"login_customer_id" text,
	"api_version" text,
	"last_successful_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_campaign_daily_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"ad_account_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"campaign_status" text NOT NULL,
	"advertising_channel_type" text,
	"date" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"currency_code" text NOT NULL,
	"google_conversions" double precision DEFAULT 0 NOT NULL,
	"google_conversion_value_cents" integer DEFAULT 0 NOT NULL,
	"last_sync_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_ads_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"period_days" integer NOT NULL,
	"prompt_id" text,
	"prompt_version" text,
	"model" text,
	"provider" text,
	"snapshot_json" jsonb NOT NULL,
	"review_json" jsonb NOT NULL,
	"decision_ids_json" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_ads_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"ad_account_id" text,
	"external_account_id" text,
	"api_version" text,
	"requested_start_date" text NOT NULL,
	"requested_end_date" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"rows_fetched" integer DEFAULT 0 NOT NULL,
	"rows_inserted" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"error_message" text,
	"provider_request_id" text,
	"triggered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_campaign_daily_metrics" ADD CONSTRAINT "ad_campaign_daily_metrics_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_ads_sync_runs" ADD CONSTRAINT "google_ads_sync_runs_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_accounts_platform_external_uq" ON "ad_accounts" USING btree ("platform","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_campaign_daily_uq" ON "ad_campaign_daily_metrics" USING btree ("ad_account_id","campaign_id","date");--> statement-breakpoint
CREATE INDEX "ad_campaign_daily_date_idx" ON "ad_campaign_daily_metrics" USING btree ("ad_account_id","date");--> statement-breakpoint
CREATE INDEX "google_ads_reports_period_idx" ON "google_ads_reports" USING btree ("period_days","generated_at");--> statement-breakpoint
CREATE INDEX "google_ads_sync_runs_account_idx" ON "google_ads_sync_runs" USING btree ("ad_account_id","started_at");--> statement-breakpoint
CREATE INDEX "google_ads_sync_runs_status_idx" ON "google_ads_sync_runs" USING btree ("status","started_at");
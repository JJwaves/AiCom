CREATE TABLE "pricing_reports" (
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
CREATE INDEX "pricing_reports_period_idx" ON "pricing_reports" USING btree ("period_days","generated_at");
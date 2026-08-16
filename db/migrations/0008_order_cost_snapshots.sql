ALTER TABLE "order_lines" ADD COLUMN "cost_snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cost_model_version" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cost_snapshot_json" jsonb;
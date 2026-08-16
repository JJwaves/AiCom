CREATE TABLE "provider_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"topic" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"delivery_id" text,
	"order_id" text,
	"outcome" text DEFAULT 'processed' NOT NULL,
	"detail" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "orders_provider_order_idx";--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "order_line_id" text;--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "storage_provider" text;--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "checksum" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_total_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_webhook_events" ADD CONSTRAINT "provider_webhook_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_webhook_events_identity_idx" ON "provider_webhook_events" USING btree ("provider","topic","provider_event_id");--> statement-breakpoint
CREATE INDEX "provider_webhook_events_order_idx" ON "provider_webhook_events" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artworks_order_line_idx" ON "artworks" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "artworks_session_status_idx" ON "artworks" USING btree ("session_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_provider_order_idx" ON "orders" USING btree ("provider","provider_order_id");
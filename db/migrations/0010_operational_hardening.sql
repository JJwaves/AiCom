CREATE TABLE "commerce_reconciliation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'shopify' NOT NULL,
	"range_start" timestamp with time zone NOT NULL,
	"range_end" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"orders_inspected" integer DEFAULT 0 NOT NULL,
	"repairs_performed" integer DEFAULT 0 NOT NULL,
	"already_consistent" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"error_message" text,
	"triggered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"session_id" text,
	"customer_id" text,
	"reason" text NOT NULL,
	"requirement_summary" text NOT NULL,
	"customer_question" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"product_id" text,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"handled_at" timestamp with time zone,
	"handled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_counters_bucket_key_window_start_pk" PRIMARY KEY("bucket_key","window_start")
);
--> statement-breakpoint
ALTER TABLE "human_handoffs" ADD CONSTRAINT "human_handoffs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_handoffs" ADD CONSTRAINT "human_handoffs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_handoffs" ADD CONSTRAINT "human_handoffs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_reconciliation_runs_status_idx" ON "commerce_reconciliation_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "human_handoffs_status_idx" ON "human_handoffs" USING btree ("delivery_status","created_at");--> statement-breakpoint
CREATE INDEX "human_handoffs_conversation_idx" ON "human_handoffs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expiry_idx" ON "rate_limit_counters" USING btree ("expires_at");
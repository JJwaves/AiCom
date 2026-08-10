CREATE TABLE "agent_configs" (
	"agent_type" text PRIMARY KEY NOT NULL,
	"autonomy_mode" text DEFAULT 'OBSERVE' NOT NULL,
	"limits_json" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_type" text NOT NULL,
	"decision_type" text NOT NULL,
	"observation" text NOT NULL,
	"reasoning_summary" text NOT NULL,
	"supporting_data_json" jsonb,
	"confidence" double precision,
	"risk_level" text NOT NULL,
	"proposed_action_json" jsonb NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"approval_status" text DEFAULT 'none' NOT NULL,
	"execution_status" text DEFAULT 'none' NOT NULL,
	"result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"conversation_id" text,
	"agent_type" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"request_type" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_micros" integer,
	"latency_ms" integer,
	"success" boolean NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_notes" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artworks" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"customer_id" text,
	"order_id" text,
	"quote_id" text,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_url" text,
	"notes" text,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"business_type" text,
	"industry" text,
	"website" text,
	"city" text,
	"state_province" text,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"customer_id" text,
	"agent_type" text DEFAULT 'sales' NOT NULL,
	"product_id" text,
	"configuration_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"outcome" text,
	"summary_json" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_insights" (
	"id" text PRIMARY KEY NOT NULL,
	"insight_type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"value_json" jsonb,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"source_refs_json" jsonb NOT NULL,
	"confidence" double precision,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"status" text DEFAULT 'candidate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_need_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"customer_id" text,
	"business_id" text,
	"business_name" text,
	"business_type" text,
	"industry" text,
	"location" text,
	"estimated_daily_orders" integer,
	"estimated_monthly_usage" integer,
	"product_interest" text,
	"desired_capacity" text,
	"desired_width" double precision,
	"desired_height" double precision,
	"desired_gusset" double precision,
	"material_preference" text,
	"gsm_preference" integer,
	"color_preference" text,
	"handle_preference" text,
	"printing_requirement" text,
	"printing_colors" integer,
	"printing_sides" integer,
	"logo_available" boolean,
	"quantity" integer,
	"budget_cents" integer,
	"target_unit_price_cents" integer,
	"shipping_postal_code" text,
	"desired_delivery_date" text,
	"price_sensitivity" text,
	"purchase_intent" text,
	"pain_points_json" jsonb,
	"objections_json" jsonb,
	"questions_asked_json" jsonb,
	"conversation_summary" text,
	"field_sources_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"shopify_customer_id" text,
	"email" text,
	"phone" text,
	"name" text,
	"business_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_shopify_customer_id_unique" UNIQUE("shopify_customer_id"),
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"customer_id" text,
	"name" text NOT NULL,
	"page" text,
	"product_id" text,
	"configuration_id" text,
	"order_id" text,
	"conversation_id" text,
	"experiment_id" text,
	"props_json" jsonb NOT NULL,
	"client_event_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_client_event_id_unique" UNIQUE("client_event_id")
);
--> statement-breakpoint
CREATE TABLE "experiment_assignments" (
	"experiment_id" text NOT NULL,
	"session_id" text NOT NULL,
	"variant" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_assignments_experiment_id_session_id_pk" PRIMARY KEY("experiment_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"hypothesis" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"primary_metric" text NOT NULL,
	"guardrail_metrics_json" jsonb,
	"control_json" jsonb,
	"variants_json" jsonb,
	"traffic_split_json" jsonb,
	"audience" text,
	"minimum_sample_size" integer,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"result_json" jsonb,
	"winner" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"structured_json" jsonb,
	"tool_name" text,
	"tool_call_id" text,
	"tool_result_json" jsonb,
	"model" text,
	"config_snapshot_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"title" text NOT NULL,
	"option_summary" text,
	"config_json" jsonb NOT NULL,
	"artwork_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"customer_id" text,
	"business_id" text,
	"conversation_id" text,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"provider_checkout_ref" text,
	"currency" text NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"ai_assisted" boolean DEFAULT false NOT NULL,
	"attribution_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"product_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"config_json" jsonb NOT NULL,
	"price_snapshot_json" jsonb,
	"source" text DEFAULT 'configurator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"source_refs_json" jsonb,
	"estimated_demand" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"human_validation_required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"customer_id" text,
	"business_id" text,
	"configuration_id" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"payload_json" jsonb NOT NULL,
	"price_snapshot_json" jsonb,
	"shipping_estimate_json" jsonb,
	"expires_at" timestamp with time zone,
	"provider_draft_order_id" text,
	"created_by" text DEFAULT 'customer' NOT NULL,
	"attribution_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"anonymous_id" text NOT NULL,
	"customer_id" text,
	"business_id" text,
	"user_agent" text,
	"first_touch_json" jsonb,
	"last_touch_json" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decision_id_agent_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."agent_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_configuration_id_product_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."product_configurations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_need_profiles" ADD CONSTRAINT "customer_need_profiles_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_need_profiles" ADD CONSTRAINT "customer_need_profiles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_need_profiles" ADD CONSTRAINT "customer_need_profiles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_configuration_id_product_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."product_configurations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_configurations" ADD CONSTRAINT "product_configurations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_configuration_id_product_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."product_configurations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_decisions_agent_idx" ON "agent_decisions" USING btree ("agent_type","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_conversation_idx" ON "ai_usage" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "approvals_decision_idx" ON "approvals" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "artworks_quote_idx" ON "artworks" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "artworks_order_idx" ON "artworks" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "conversations_session_idx" ON "conversations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "customer_insights_type_idx" ON "customer_insights" USING btree ("insight_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_need_profiles_session_uq" ON "customer_need_profiles" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "customers_business_idx" ON "customers" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "events_session_idx" ON "events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_name_idx" ON "events" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_session_idx" ON "orders" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_provider_order_idx" ON "orders" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_configurations_session_product_uq" ON "product_configurations" USING btree ("session_id","product_id");--> statement-breakpoint
CREATE INDEX "quotes_session_idx" ON "quotes" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "quotes_customer_idx" ON "quotes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sessions_anonymous_idx" ON "sessions" USING btree ("anonymous_id");--> statement-breakpoint
CREATE INDEX "sessions_customer_idx" ON "sessions" USING btree ("customer_id");
CREATE TABLE "agent_action_events" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"detail_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"source_agent" text NOT NULL,
	"source_decision_id" text,
	"action_type" text NOT NULL,
	"title" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"identity_key" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"origin_action_id" text,
	"superseded_by_action_id" text,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"execution_status" text DEFAULT 'NOT_SUPPORTED' NOT NULL,
	"risk_level" text NOT NULL,
	"model_suggested_risk" text,
	"approval_required" boolean DEFAULT true NOT NULL,
	"latest_evaluation_id" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"created_by" text NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardrail_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"action_revision" integer DEFAULT 1 NOT NULL,
	"policy_version" text NOT NULL,
	"source_agent" text NOT NULL,
	"action_type" text NOT NULL,
	"autonomy_mode" text NOT NULL,
	"allowed" boolean NOT NULL,
	"execution_eligible" boolean NOT NULL,
	"approval_required" boolean NOT NULL,
	"risk_level" text NOT NULL,
	"violated_rules_json" jsonb NOT NULL,
	"missing_configuration_json" jsonb NOT NULL,
	"reason" text NOT NULL,
	"execution_support" text NOT NULL,
	"limits_snapshot_json" jsonb NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "action_id" text;--> statement-breakpoint
ALTER TABLE "agent_action_events" ADD CONSTRAINT "agent_action_events_action_id_agent_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."agent_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_source_decision_id_agent_decisions_id_fk" FOREIGN KEY ("source_decision_id") REFERENCES "public"."agent_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_evaluations" ADD CONSTRAINT "guardrail_evaluations_action_id_agent_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."agent_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_action_events_action_idx" ON "agent_action_events" USING btree ("action_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_actions_status_idx" ON "agent_actions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "agent_actions_source_idx" ON "agent_actions" USING btree ("source_agent","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_actions_root_decision_idx" ON "agent_actions" USING btree ("source_decision_id") WHERE origin_action_id is null and source_decision_id is not null;--> statement-breakpoint
CREATE INDEX "guardrail_evaluations_action_idx" ON "guardrail_evaluations" USING btree ("action_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "approvals_action_idx" ON "approvals" USING btree ("action_id");
CREATE TABLE "experiment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"detail_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD COLUMN "exposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "experiment_type" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "target_key" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "variant_key" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "target_version" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "audience_json" jsonb;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "secondary_metrics_json" jsonb;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "assignment_salt" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "policy_version" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "policy_snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "source_decision_id" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "source_action_id" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "launched_by" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "launched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "stopped_by" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "stop_reason" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "state_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "experiment_events" ADD CONSTRAINT "experiment_events_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiment_events_experiment_idx" ON "experiment_events" USING btree ("experiment_id","created_at");--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_source_decision_id_agent_decisions_id_fk" FOREIGN KEY ("source_decision_id") REFERENCES "public"."agent_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_source_action_id_agent_actions_id_fk" FOREIGN KEY ("source_action_id") REFERENCES "public"."agent_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiment_assignments_variant_idx" ON "experiment_assignments" USING btree ("experiment_id","variant");--> statement-breakpoint
CREATE INDEX "experiments_status_idx" ON "experiments" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_running_target_idx" ON "experiments" USING btree ("target_key") WHERE status = 'running' and target_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_source_action_idx" ON "experiments" USING btree ("source_action_id") WHERE source_action_id is not null;
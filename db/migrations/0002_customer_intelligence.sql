CREATE TABLE "conversation_classifications" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"status" text DEFAULT 'classified' NOT NULL,
	"classifier_version" text NOT NULL,
	"prompt_id" text,
	"prompt_version" text,
	"model" text,
	"error_code" text,
	"questions_json" jsonb NOT NULL,
	"objections_json" jsonb NOT NULL,
	"unsupported_requests_json" jsonb NOT NULL,
	"user_message_count" integer DEFAULT 0 NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_opportunities" ADD COLUMN "opportunity_type" text;--> statement-breakpoint
ALTER TABLE "product_opportunities" ADD COLUMN "value_json" jsonb;--> statement-breakpoint
ALTER TABLE "product_opportunities" ADD COLUMN "period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_opportunities" ADD COLUMN "period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_classifications" ADD CONSTRAINT "conversation_classifications_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_classifications_conversation_uq" ON "conversation_classifications" USING btree ("conversation_id");
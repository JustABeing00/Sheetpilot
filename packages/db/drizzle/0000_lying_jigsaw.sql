CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"format" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"original_name" text NOT NULL,
	"format" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"row_count" integer,
	"column_names" jsonb NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"entity_key" text NOT NULL,
	"reason" text NOT NULL,
	"severity" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"suggested_values" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"resolution" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"workflow_slug" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"active" boolean NOT NULL,
	"rules" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"entity_key" text NOT NULL,
	"matched_rule_ids" jsonb NOT NULL,
	"ai_assisted" boolean NOT NULL,
	"confidence" double precision NOT NULL,
	"review_reasons" jsonb NOT NULL,
	"output_values" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"name" text NOT NULL,
	"step_order" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"metrics" jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_slug" text NOT NULL,
	"workflow_version" integer NOT NULL,
	"status" text NOT NULL,
	"primary_file_id" text NOT NULL,
	"events_file_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"stats" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"version" integer NOT NULL,
	"steps" jsonb NOT NULL,
	"config_fields" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflows_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "artifacts_run_idx" ON "artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "files_checksum_idx" ON "files" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "review_items_run_status_idx" ON "review_items" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "rule_sets_workflow_slug_idx" ON "rule_sets" USING btree ("workflow_slug","active");--> statement-breakpoint
CREATE INDEX "run_decisions_run_idx" ON "run_decisions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "run_steps_run_idx" ON "run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_status_created_idx" ON "runs" USING btree ("status","created_at");
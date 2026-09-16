CREATE TABLE "workflow_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_slug" text NOT NULL,
	"workflow_version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"version" integer NOT NULL,
	"assignments" jsonb NOT NULL,
	"mappings" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "configuration_id" text;--> statement-breakpoint
CREATE INDEX "workflow_configurations_slug_idx" ON "workflow_configurations" USING btree ("workflow_slug");
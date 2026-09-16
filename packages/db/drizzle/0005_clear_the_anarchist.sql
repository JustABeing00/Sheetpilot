CREATE TABLE "run_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"workflow_slug" text NOT NULL,
	"workflow_version" integer NOT NULL,
	"configuration_id" text,
	"configuration" jsonb,
	"rule_set_id" text,
	"rule_set" jsonb,
	"captured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_snapshots_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE INDEX "run_snapshots_run_idx" ON "run_snapshots" USING btree ("run_id");
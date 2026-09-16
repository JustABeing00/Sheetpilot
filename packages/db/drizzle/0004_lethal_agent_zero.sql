CREATE TABLE "review_resolutions" (
	"id" text PRIMARY KEY NOT NULL,
	"review_item_id" text NOT NULL,
	"run_id" text NOT NULL,
	"entity_key" text NOT NULL,
	"action" text NOT NULL,
	"previous_status" text NOT NULL,
	"resulting_state" text NOT NULL,
	"automation" jsonb NOT NULL,
	"suggested_values" jsonb NOT NULL,
	"applied_values" jsonb NOT NULL,
	"changed_fields" jsonb NOT NULL,
	"note" text NOT NULL,
	"resolved_by" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "review_resolutions_item_idx" ON "review_resolutions" USING btree ("review_item_id");--> statement-breakpoint
CREATE INDEX "review_resolutions_run_idx" ON "review_resolutions" USING btree ("run_id");
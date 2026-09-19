CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tenant_id" text,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 2 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "jobs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE INDEX "jobs_status_available_idx" ON "jobs" USING btree ("status","available_at");
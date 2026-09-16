CREATE TABLE "datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"kind" text NOT NULL,
	"original_name" text NOT NULL,
	"format" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"sheet_names" jsonb NOT NULL,
	"sheet_name" text,
	"row_count" integer NOT NULL,
	"row_count_exact" boolean NOT NULL,
	"truncated" boolean NOT NULL,
	"scan_limit" integer NOT NULL,
	"columns" jsonb NOT NULL,
	"sample_rows" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"inspected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "datasets_file_idx" ON "datasets" USING btree ("file_id");
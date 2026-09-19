ALTER TABLE "artifacts" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "review_resolutions" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "run_decisions" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "run_snapshots" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "workflow_configurations" ADD COLUMN "tenant_id" text;
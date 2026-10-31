ALTER TABLE "job" ADD COLUMN "concurrencyKey" text NOT NULL;--> statement-breakpoint
ALTER TABLE "review" ADD COLUMN "startedAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "job_running_concurrency_idx" ON "job" ("concurrencyKey") WHERE "status" = 'running';
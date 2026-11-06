ALTER TABLE "finding" ADD COLUMN "scenario" text;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "evidence" text;--> statement-breakpoint
-- Severities move to P0-P3: critical is P0, major P1, minor P2. P3 is new and below them all.
UPDATE "finding" SET "severity" = CASE "severity"
  WHEN 'critical' THEN 'P0'
  WHEN 'major' THEN 'P1'
  WHEN 'minor' THEN 'P2'
  ELSE "severity"
END;
--> statement-breakpoint
UPDATE "review" SET "repeated" = (
  SELECT coalesce(jsonb_agg(
    jsonb_set(item, '{severity}', to_jsonb(CASE item->>'severity'
      WHEN 'critical' THEN 'P0'
      WHEN 'major' THEN 'P1'
      WHEN 'minor' THEN 'P2'
      ELSE item->>'severity'
    END))
  ), '[]'::jsonb)
  FROM jsonb_array_elements("repeated") AS item
)
WHERE "repeated" IS NOT NULL AND jsonb_typeof("repeated") = 'array';

-- The tar parser dropped the ustar prefix, so deep files were stored under their
-- base name. Most repositories failed on a duplicate path; the rest are `ready` with
-- wrong paths, and an unchanged sha would skip them. Clear the sha and index them all.
UPDATE "repository" SET "indexStatus" = 'pending', "indexedSha" = NULL, "indexError" = NULL;
--> statement-breakpoint
-- runAt waits out the rollout: the old worker would index these with the old parser.
INSERT INTO "job" ("kind", "dedupeKey", "concurrencyKey", "payload", "runAt")
SELECT
  'IndexRepository',
  'index:' || "id",
  'index:' || "id",
  jsonb_build_object('_tag', 'IndexRepository', 'repositoryId', "id"),
  now() + interval '5 minutes'
FROM "repository"
ON CONFLICT DO NOTHING;

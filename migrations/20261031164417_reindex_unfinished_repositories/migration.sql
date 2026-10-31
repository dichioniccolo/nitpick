-- The tar parser cut pax paths at a space and ran the worker out of memory, so the
-- previous reindex left repositories unfinished with no job left to retry them.
UPDATE "repository" SET "indexStatus" = 'pending', "indexError" = NULL WHERE "indexStatus" <> 'ready';
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
WHERE "indexStatus" = 'pending'
ON CONFLICT DO NOTHING;

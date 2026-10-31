import { installation, repository } from "@nitpick/code-graph-tables";
import { GitHub } from "@nitpick/github";
import { IndexRepository } from "@nitpick/review-domain";
import { Database } from "@nitpick/postgres";
import { and, eq, notInArray } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { Queue } from "./Queue.ts";

/** Match the database to what GitHub says the installation can read, then index what is new. */
export const syncInstallation = Effect.fn("review.installation.sync")(function* (
  installationId: number,
) {
  const db = yield* Database;
  const github = yield* GitHub;
  const queue = yield* Queue;

  const [known] = yield* db
    .select()
    .from(installation)
    .where(eq(installation.id, installationId))
    .pipe(Effect.orDie);

  if (known === undefined) return;
  const repositories = yield* github.listRepositories(installationId);
  yield* db
    .delete(repository)
    .where(
      and(
        eq(repository.installationId, installationId),
        notInArray(repository.id, [0, ...repositories.map((row) => row.id)]),
      ),
    )
    .pipe(Effect.orDie);
  yield* Effect.forEach(repositories, (row) =>
    Effect.gen(function* () {
      yield* db
        .insert(repository)
        .values({
          id: row.id,
          installationId,
          fullName: row.fullName,
          defaultBranch: row.defaultBranch,
          private: row.private,
        })
        .onConflictDoUpdate({
          target: repository.id,
          set: { fullName: row.fullName, defaultBranch: row.defaultBranch, private: row.private },
        })
        .pipe(Effect.orDie);
      yield* queue.enqueue(IndexRepository.make({ repositoryId: row.id }));
    }),
  );
});

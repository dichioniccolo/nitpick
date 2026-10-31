import { repository } from "@nitpick/code-graph-tables";
import { GitHub, toRepoRef } from "@nitpick/github";
import { Database } from "@nitpick/postgres";
import { finding, learning } from "@nitpick/review-tables";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

/** Comments checked per run; each one costs a GitHub API call. */
const batchSize = 300;

/**
 * GitHub sends no webhook for reactions, so a timer reads them. More thumbs
 * down than up teaches "noise", the reverse "useful"; a tie removes the lesson.
 */
export const syncFeedback = Effect.fn("review.feedback.sync")(function* () {
  const db = yield* Database;
  const github = yield* GitHub;

  const rows = yield* db
    .select({
      item: finding,
      installationId: repository.installationId,
      fullName: repository.fullName,
    })
    .from(finding)
    .innerJoin(repository, eq(repository.id, finding.repositoryId))
    .where(
      and(
        isNotNull(finding.githubCommentId),
        gt(finding.createdAt, sql`now() - interval '14 days'`),
      ),
    )
    .orderBy(desc(finding.createdAt))
    .limit(batchSize)
    .pipe(Effect.orDie);

  yield* Effect.forEach(
    rows,
    ({ item, installationId, fullName }) =>
      Effect.gen(function* () {
        const commentId = item.githubCommentId;

        if (commentId === null) return;

        const reactions = yield* github.commentReactions(
          toRepoRef(installationId, fullName),
          commentId,
        );

        if (reactions.up === item.reactionsUp && reactions.down === item.reactionsDown) return;
        yield* db
          .update(finding)
          .set({ reactionsUp: reactions.up, reactionsDown: reactions.down })
          .where(eq(finding.id, item.id));

        if (reactions.up === reactions.down) {
          yield* db.delete(learning).where(eq(learning.findingId, item.id));

          return;
        }

        const verdict = reactions.up > reactions.down ? ("useful" as const) : ("noise" as const);
        yield* db
          .insert(learning)
          .values({
            repositoryId: item.repositoryId,
            findingId: item.id,
            verdict,
            text: `${item.category} in ${item.path}: ${item.title}`,
          })
          .onConflictDoUpdate({ target: learning.findingId, set: { verdict } });
      }).pipe(
        // A deleted comment or lost access should not stop the rest of the batch.
        Effect.catchTag("GitHubError", (error) =>
          Effect.logDebug("reaction read failed", error.status),
        ),
        Effect.orDie,
      ),
    { concurrency: 4 },
  );
});

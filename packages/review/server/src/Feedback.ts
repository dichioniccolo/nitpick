import { installation, repository } from "@nitpick/code-graph-tables";
import { GitHub, type GitHubError, type RepoRef, toRepoRef } from "@nitpick/github";
import { Database } from "@nitpick/postgres";
import { finding, learning } from "@nitpick/review-tables";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

/** Comments checked per run; each one costs a GitHub API call. */
const batchSize = 300;

const trustedPermissions: ReadonlySet<string> = new Set(["write", "maintain", "admin"]);

/**
 * GitHub sends no webhook for reactions, so a timer reads them. Only people who
 * can push count: on a public repository anyone can react, and a stranger's
 * thumbs down must not silence a security finding. More thumbs down than up
 * teaches "noise", the reverse "useful"; a tie removes the lesson.
 */
export const syncFeedback = Effect.fn("review.feedback.sync")(function* () {
  const db = yield* Database;
  const github = yield* GitHub;

  const permissions = new Map<string, Effect.Effect<boolean, GitHubError>>();

  /** One permission read per person and repository, per run. */
  const canPush = Effect.fnUntraced(function* (ref: RepoRef, login: string) {
    const key = `${ref.owner}/${ref.repo}:${login}`;
    const known = permissions.get(key);

    if (known !== undefined) return yield* known;

    const lookup = yield* Effect.cached(
      github
        .userPermission(ref, login)
        .pipe(Effect.map((permission) => trustedPermissions.has(permission))),
    );

    permissions.set(key, lookup);

    return yield* lookup;
  });

  const rows = yield* db
    .select({
      item: finding,
      installationId: repository.installationId,
      fullName: repository.fullName,
    })
    .from(finding)
    .innerJoin(repository, eq(repository.id, finding.repositoryId))
    .innerJoin(installation, eq(installation.id, repository.installationId))
    .where(
      and(
        eq(installation.suspended, false),
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

        const ref = toRepoRef(installationId, fullName);
        const all = yield* github.commentReactions(ref, commentId);

        const votes = all.filter(({ content }) => content === "+1" || content === "-1");

        const trusted = yield* Effect.filter(
          votes,
          ({ user }) => (user === null ? Effect.succeed(false) : canPush(ref, user)),
          { concurrency: 4 },
        );

        const up = trusted.filter(({ content }) => content === "+1").length;
        const down = trusted.length - up;

        if (up === item.reactionsUp && down === item.reactionsDown) return;
        yield* db
          .update(finding)
          .set({ reactionsUp: up, reactionsDown: down })
          .where(eq(finding.id, item.id));

        if (up === down) {
          yield* db.delete(learning).where(eq(learning.findingId, item.id));

          return;
        }

        const verdict = up > down ? ("useful" as const) : ("noise" as const);
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

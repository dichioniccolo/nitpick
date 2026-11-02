import { repository } from "@nitpick/code-graph-tables";
import { repositoryMember } from "@nitpick/identity-tables";
import { Database } from "@nitpick/postgres";
import { IndexRepository, ReviewPullRequest } from "@nitpick/review-domain";
import { finding, learning, review, rule } from "@nitpick/review-tables";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as S from "effect/Schema";

import { Queue } from "./Queue.ts";

/** One answer for "absent" and "not yours", so a probe learns nothing about other tenants. */
export class NotFound extends Data.TaggedError("NotFound")<{}> {}

type Repository = typeof repository.$inferSelect;

/** A `uuid` column raises 22P02 on anything else. */
const RowId = S.String.check(S.isUUID());

/** A safe integer, which NaN and a `bigint` overflow like 1e20 are not. */
const RepositoryId = S.Int;

/** GitHub's `owner/name`; a NUL in a text parameter would otherwise fail in Postgres. */
const RepositoryName = S.String.check(S.isPattern(/^[\w.-]+\/[\w.-]+$/));

/** An id that cannot name a row is absent, and fails before any query reaches Postgres. */
const decodeId =
  <A>(schema: S.Codec<A, A>) =>
  (input: A): Effect.Effect<A, NotFound> =>
    S.decodeEffect(schema)(input).pipe(Effect.mapError(() => new NotFound()));

const decodeRowId = decodeId(RowId);
const decodeRepositoryId = decodeId(RepositoryId);
const decodeRepositoryName = decodeId(RepositoryName);

export class Dashboard extends Context.Service<
  Dashboard,
  {
    readonly repositories: (userId: string) => Effect.Effect<ReadonlyArray<Repository>>;
    readonly repository: (userId: string, fullName: string) => Effect.Effect<Repository, NotFound>;
    readonly recentReviews: (
      userId: string,
      repositoryId: number | null,
    ) => Effect.Effect<
      ReadonlyArray<
        typeof review.$inferSelect & { readonly fullName: string; readonly findings: number }
      >
    >;
    readonly review: (
      userId: string,
      id: string,
    ) => Effect.Effect<
      {
        readonly review: typeof review.$inferSelect;
        readonly fullName: string;
        readonly findings: ReadonlyArray<typeof finding.$inferSelect>;
      },
      NotFound
    >;
    readonly rules: (
      userId: string,
      repositoryId: number,
    ) => Effect.Effect<ReadonlyArray<typeof rule.$inferSelect>, NotFound>;
    readonly learnings: (
      userId: string,
      repositoryId: number,
    ) => Effect.Effect<ReadonlyArray<typeof learning.$inferSelect>, NotFound>;
    readonly addRule: (
      user: { id: string; login: string },
      repositoryId: number,
      text: string,
    ) => Effect.Effect<void, NotFound>;
    readonly setRuleEnabled: (
      userId: string,
      ruleId: string,
      enabled: boolean,
    ) => Effect.Effect<void, NotFound>;
    readonly deleteRule: (userId: string, ruleId: string) => Effect.Effect<void, NotFound>;
    readonly setRepositoryEnabled: (
      userId: string,
      repositoryId: number,
      enabled: boolean,
    ) => Effect.Effect<void, NotFound>;
    readonly reindex: (userId: string, repositoryId: number) => Effect.Effect<void, NotFound>;
    /** Queue a fresh review of the PR's current head, as `@<app> review` would. */
    readonly retrigger: (userId: string, reviewId: string) => Effect.Effect<void, NotFound>;
  }
>()("@nitpick/review/Dashboard") {
  static readonly layer = Layer.effect(
    Dashboard,
    Effect.gen(function* () {
      const db = yield* Database;
      const queue = yield* Queue;

      const requireMember = (userId: string, repositoryId: number) =>
        decodeRepositoryId(repositoryId).pipe(
          Effect.andThen(
            db
              .select({ id: repositoryMember.repositoryId })
              .from(repositoryMember)
              .where(
                and(
                  eq(repositoryMember.userId, userId),
                  eq(repositoryMember.repositoryId, repositoryId),
                ),
              )
              .pipe(Effect.orDie),
          ),
          Effect.flatMap((rows) => (rows.length === 0 ? Effect.fail(new NotFound()) : Effect.void)),
        );

      const ruleOwner = (userId: string, ruleId: string) =>
        decodeRowId(ruleId).pipe(
          Effect.andThen(
            db
              .select({ repositoryId: rule.repositoryId })
              .from(rule)
              .where(eq(rule.id, ruleId))
              .pipe(Effect.orDie),
          ),
          Effect.flatMap(([row]) =>
            row === undefined
              ? Effect.fail(new NotFound())
              : requireMember(userId, row.repositoryId),
          ),
        );

      return {
        repositories: (userId) =>
          db
            .select({ item: repository })
            .from(repository)
            .innerJoin(repositoryMember, eq(repositoryMember.repositoryId, repository.id))
            .where(eq(repositoryMember.userId, userId))
            .orderBy(asc(repository.fullName))
            .pipe(
              Effect.orDie,
              Effect.map((rows) => rows.map((row) => row.item)),
            ),
        repository: (userId, fullName) =>
          decodeRepositoryName(fullName).pipe(
            Effect.andThen(
              db
                .select({ item: repository })
                .from(repository)
                .innerJoin(repositoryMember, eq(repositoryMember.repositoryId, repository.id))
                .where(and(eq(repositoryMember.userId, userId), eq(repository.fullName, fullName)))
                .pipe(Effect.orDie),
            ),
            Effect.flatMap(([row]) =>
              row === undefined ? Effect.fail(new NotFound()) : Effect.succeed(row.item),
            ),
          ),
        recentReviews: (userId, repositoryId) =>
          db
            .select({ item: review, fullName: repository.fullName, findings: count(finding.id) })
            .from(review)
            .innerJoin(repository, eq(repository.id, review.repositoryId))
            .innerJoin(repositoryMember, eq(repositoryMember.repositoryId, review.repositoryId))
            .leftJoin(finding, eq(finding.reviewId, review.id))
            .where(
              and(
                eq(repositoryMember.userId, userId),
                repositoryId === null ? sql`true` : eq(review.repositoryId, repositoryId),
              ),
            )
            .groupBy(review.id, repository.fullName)
            .orderBy(desc(review.createdAt))
            .limit(50)
            .pipe(
              Effect.orDie,
              Effect.map((rows) =>
                rows.map((row) => ({
                  ...row.item,
                  fullName: row.fullName,
                  findings: row.findings,
                })),
              ),
            ),
        review: (userId, id) =>
          Effect.gen(function* () {
            yield* decodeRowId(id);

            const [row] = yield* db
              .select({ item: review, fullName: repository.fullName })
              .from(review)
              .innerJoin(repository, eq(repository.id, review.repositoryId))
              .where(eq(review.id, id))
              .pipe(Effect.orDie);

            if (row === undefined) return yield* new NotFound();
            yield* requireMember(userId, row.item.repositoryId);

            const findings = yield* db
              .select()
              .from(finding)
              .where(eq(finding.reviewId, id))
              .orderBy(
                sql`case ${finding.severity} when 'critical' then 0 when 'major' then 1 else 2 end`,
              )
              .pipe(Effect.orDie);

            return { review: row.item, fullName: row.fullName, findings };
          }),
        rules: (userId, repositoryId) =>
          requireMember(userId, repositoryId).pipe(
            Effect.andThen(
              db
                .select()
                .from(rule)
                .where(eq(rule.repositoryId, repositoryId))
                .orderBy(asc(rule.createdAt))
                .pipe(Effect.orDie),
            ),
          ),
        learnings: (userId, repositoryId) =>
          requireMember(userId, repositoryId).pipe(
            Effect.andThen(
              db
                .select()
                .from(learning)
                .where(eq(learning.repositoryId, repositoryId))
                .orderBy(desc(learning.createdAt))
                .limit(50)
                .pipe(Effect.orDie),
            ),
          ),
        addRule: (user, repositoryId, text) =>
          requireMember(user.id, repositoryId).pipe(
            Effect.andThen(
              db
                .insert(rule)
                .values({ repositoryId, text, createdByLogin: user.login })
                .pipe(Effect.asVoid, Effect.orDie),
            ),
          ),
        setRuleEnabled: (userId, ruleId, enabled) =>
          ruleOwner(userId, ruleId).pipe(
            Effect.andThen(
              db
                .update(rule)
                .set({ enabled })
                .where(eq(rule.id, ruleId))
                .pipe(Effect.asVoid, Effect.orDie),
            ),
          ),
        deleteRule: (userId, ruleId) =>
          ruleOwner(userId, ruleId).pipe(
            Effect.andThen(
              db.delete(rule).where(eq(rule.id, ruleId)).pipe(Effect.asVoid, Effect.orDie),
            ),
          ),
        setRepositoryEnabled: (userId, repositoryId, enabled) =>
          requireMember(userId, repositoryId).pipe(
            Effect.andThen(
              db
                .update(repository)
                .set({ enabled })
                .where(eq(repository.id, repositoryId))
                .pipe(Effect.asVoid, Effect.orDie),
            ),
          ),
        reindex: (userId, repositoryId) =>
          requireMember(userId, repositoryId).pipe(
            Effect.andThen(queue.enqueue(IndexRepository.make({ repositoryId }))),
          ),
        retrigger: (userId, reviewId) =>
          Effect.gen(function* () {
            yield* decodeRowId(reviewId);

            const [row] = yield* db
              .select({ repositoryId: review.repositoryId, prNumber: review.prNumber })
              .from(review)
              .where(eq(review.id, reviewId))
              .pipe(Effect.orDie);

            if (row === undefined) return yield* new NotFound();
            yield* requireMember(userId, row.repositoryId);
            yield* queue.enqueue(
              ReviewPullRequest.make({
                repositoryId: row.repositoryId,
                prNumber: row.prNumber,
                headSha: "",
                trigger: "requested",
              }),
            );
          }),
      };
    }),
  );
}

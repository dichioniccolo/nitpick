import { type JobPayload, JobPayload as JobPayloadSchema } from "@nitpick/review-domain";
import { job } from "@nitpick/review-tables";
import { Database } from "@nitpick/postgres";
import { eq, sql as drizzleSql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as S from "effect/Schema";
import { SqlClient } from "effect/sql";

const maxAttempts = 3;

/** Arbitrary and fixed: the advisory lock that makes claiming one job at a time. */
const claimLock = 7_460_912;

/** The key that collapses duplicates: one queued job per target. */
export const dedupeKeyOf = (payload: JobPayload): string =>
  Match.valueTags(payload, {
    SyncInstallation: ({ installationId }) => `sync:${installationId}`,
    IndexRepository: ({ repositoryId }) => `index:${repositoryId}`,
    ReviewPullRequest: ({ repositoryId, prNumber, headSha }) =>
      `review:${repositoryId}:${prNumber}:${headSha}`,
    SyncFeedback: () => "feedback",
  });

/**
 * The scope in which one job may run at a time. Reviews share it per pull
 * request, so a mention review, whose `headSha` is empty, cannot race a head job.
 */
export const concurrencyKeyOf = (payload: JobPayload): string =>
  Match.value(payload).pipe(
    Match.tag(
      "ReviewPullRequest",
      ({ repositoryId, prNumber }) => `pr:${repositoryId}:${prNumber}`,
    ),
    Match.orElse(dedupeKeyOf),
  );

export interface ClaimedJob {
  readonly id: string;
  readonly attempts: number;
  readonly payload: JobPayload;
}

const decodePayload = S.decodeUnknownEffect(JobPayloadSchema);

export class Queue extends Context.Service<
  Queue,
  {
    readonly enqueue: (payload: JobPayload) => Effect.Effect<void>;
    readonly claim: Effect.Effect<ClaimedJob | null>;
    readonly heartbeat: (id: string) => Effect.Effect<void>;
    readonly complete: (id: string) => Effect.Effect<void>;
    /** Forget finished jobs and delivery ids older than 14 days. */
    readonly prune: Effect.Effect<void>;
    /** Fail jobs whose last attempt died with the worker; a crash never reaches `fail`. */
    readonly sweep: Effect.Effect<void>;
    /** Back off and retry, or stop at `permanent` or the attempt limit. */
    readonly fail: (claimed: ClaimedJob, error: string, permanent: boolean) => Effect.Effect<void>;
  }
>()("@nitpick/review/Queue") {
  static readonly layer = Layer.effect(
    Queue,
    Effect.gen(function* () {
      const db = yield* Database;
      const sql = yield* SqlClient.SqlClient;

      return {
        enqueue: (payload) =>
          db
            .insert(job)
            .values({
              kind: payload._tag,
              dedupeKey: dedupeKeyOf(payload),
              concurrencyKey: concurrencyKeyOf(payload),
              payload,
            })
            .onConflictDoNothing()
            .pipe(Effect.asVoid, Effect.orDie),
        // Serialized: `skip locked` hides a claim in flight, so two workers could otherwise
        // pick different jobs with one `concurrencyKey`.
        claim: sql
          .withTransaction(
            Effect.andThen(
              sql`select pg_advisory_xact_lock(${claimLock})`,
              sql<{ id: string; attempts: number; payload: unknown }>`
          update job set status = 'running', attempts = attempts + 1, "lockedUntil" = now() + interval '3 minutes'
          where id = (
            select candidate.id from job candidate
            where (
              (candidate.status = 'queued' and candidate."runAt" <= now())
              or (candidate.status = 'running' and candidate."lockedUntil" < now())
            )
            and candidate.attempts < ${maxAttempts}
            and not exists (
              select 1 from job other
              where other."concurrencyKey" = candidate."concurrencyKey"
                and other.id <> candidate.id
                and other.status = 'running'
                and other."lockedUntil" >= now()
            )
            order by candidate."runAt"
            for update skip locked
            limit 1
          )
          returning id, attempts, payload`,
            ),
          )
          .pipe(
            Effect.orDie,
            Effect.flatMap(([row]) =>
              row === undefined
                ? Effect.succeed(null)
                : decodePayload(row.payload).pipe(
                    Effect.map((payload): ClaimedJob | null => ({
                      id: row.id,
                      attempts: row.attempts,
                      payload,
                    })),
                    // Retrying cannot repair a row, and a throw here would kill the worker.
                    Effect.catchTag("SchemaError", () =>
                      db
                        .update(job)
                        .set({ status: "failed", lockedUntil: null, lastError: "InvalidPayload" })
                        .where(eq(job.id, row.id))
                        .pipe(
                          Effect.orDie,
                          Effect.andThen(Effect.logWarning("invalid job payload", row.id)),
                          Effect.as(null),
                        ),
                    ),
                  ),
            ),
          ),
        heartbeat: (id) =>
          db
            .update(job)
            .set({ lockedUntil: drizzleSql`now() + interval '3 minutes'` })
            .where(eq(job.id, id))
            .pipe(Effect.asVoid, Effect.orDie),
        complete: (id) =>
          db
            .update(job)
            .set({ status: "done", lockedUntil: null, lastError: null })
            .where(eq(job.id, id))
            .pipe(Effect.asVoid, Effect.orDie),
        prune: Effect.all([
          sql`delete from job where status in ('done', 'failed') and "createdAt" < now() - interval '14 days'`,
          sql`delete from webhook_delivery where "receivedAt" < now() - interval '14 days'`,
        ]).pipe(Effect.asVoid, Effect.orDie),
        sweep: sql`
          update job set status = 'failed', "lockedUntil" = null, "lastError" = 'LeaseExpired'
          where status = 'running' and "lockedUntil" < now() and attempts >= ${maxAttempts}`.pipe(
          Effect.asVoid,
          Effect.orDie,
        ),
        fail: ({ id, attempts }, error, permanent) =>
          Effect.gen(function* () {
            const message = error.slice(0, 2000);

            if (permanent || attempts >= maxAttempts) {
              yield* db
                .update(job)
                .set({ status: "failed", lockedUntil: null, lastError: message })
                .where(eq(job.id, id));

              return;
            }

            // A twin queued while this one ran holds the unique key and supersedes it.
            yield* sql`
              update job set
                status = case when twin.id is null then 'queued' else 'done' end,
                "lockedUntil" = null,
                "lastError" = ${message},
                "runAt" = now() + (${2 ** attempts} * interval '1 minute')
              from job self left join job twin
                on twin."dedupeKey" = self."dedupeKey" and twin.status = 'queued' and twin.id <> self.id
              where job.id = self.id and job.id = ${id}`;
          }).pipe(Effect.orDie),
      };
    }),
  );
}

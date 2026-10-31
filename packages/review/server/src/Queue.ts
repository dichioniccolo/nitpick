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

/** The key that collapses duplicates: one queued job per target. */
export const dedupeKeyOf = (payload: JobPayload): string =>
  Match.valueTags(payload, {
    SyncInstallation: ({ installationId }) => `sync:${installationId}`,
    IndexRepository: ({ repositoryId }) => `index:${repositoryId}`,
    ReviewPullRequest: ({ repositoryId, prNumber, headSha }) =>
      `review:${repositoryId}:${prNumber}:${headSha}`,
    SyncFeedback: () => "feedback",
  });

export interface ClaimedJob {
  readonly id: string;
  readonly attempts: number;
  readonly payload: JobPayload;
}

const decodePayload = S.decodeUnknownSync(JobPayloadSchema);

export class Queue extends Context.Service<
  Queue,
  {
    readonly enqueue: (payload: JobPayload) => Effect.Effect<void>;
    readonly claim: Effect.Effect<ClaimedJob | null>;
    readonly heartbeat: (id: string) => Effect.Effect<void>;
    readonly complete: (id: string) => Effect.Effect<void>;
    /** Forget finished jobs and old delivery ids. GitHub redelivers within days, not weeks. */
    readonly prune: Effect.Effect<void>;
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
            .values({ kind: payload._tag, dedupeKey: dedupeKeyOf(payload), payload })
            .onConflictDoNothing()
            .pipe(Effect.asVoid, Effect.orDie),
        claim: sql<{ id: string; attempts: number; payload: unknown }>`
          update job set status = 'running', attempts = attempts + 1, "lockedUntil" = now() + interval '3 minutes'
          where id = (
            select candidate.id from job candidate
            where (
              (candidate.status = 'queued' and candidate."runAt" <= now())
              or (candidate.status = 'running' and candidate."lockedUntil" < now())
            )
            and not exists (
              select 1 from job other
              where other."dedupeKey" = candidate."dedupeKey"
                and other.id <> candidate.id
                and other.status = 'running'
                and other."lockedUntil" >= now()
            )
            order by candidate."runAt"
            for update skip locked
            limit 1
          )
          returning id, attempts, payload`.pipe(
          Effect.orDie,
          Effect.map(([row]) =>
            row === undefined
              ? null
              : { id: row.id, attempts: row.attempts, payload: decodePayload(row.payload) },
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

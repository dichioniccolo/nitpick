import { BunRuntime } from "@effect/platform-bun";
import { Claude } from "@nitpick/anthropic";
import { CodeSearch, Indexer } from "@nitpick/code-graph-server";
import { describeFailure, GitHub } from "@nitpick/github";
import { SyncFeedback } from "@nitpick/review-domain";
import { Database, Postgres } from "@nitpick/postgres";
import { Telemetry } from "@nitpick/telemetry";
import {
  type ClaimedJob,
  Queue,
  reviewPullRequest,
  Settings,
  sweepStuckReviews,
  syncFeedback,
  syncInstallation,
} from "@nitpick/review-server/worker";
import { TreeSitter } from "@nitpick/tree-sitter";
import * as Config from "effect/Config";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import { SqlClient } from "effect/sql";

import { heartbeatLoop, isPermanent, surviveFailure } from "./loop.ts";

const handle = ({ payload }: ClaimedJob) =>
  Effect.gen(function* () {
    yield* Match.valueTags(payload, {
      SyncInstallation: ({ installationId }) => syncInstallation(installationId),
      IndexRepository: ({ repositoryId }) =>
        Effect.flatMap(Effect.service(Indexer), (indexer) => indexer.indexRepository(repositoryId)),
      ReviewPullRequest: (review) => reviewPullRequest(review),
      SyncFeedback: () => syncFeedback(),
    });
  });

/**
 * Ends the job span in error, so tail sampling keeps it. The span carries only this summary:
 * a query error's message holds its parameters, which for an index insert is file content.
 */
class JobFailed extends Data.TaggedError("JobFailed")<{
  readonly message: string;
  readonly permanent: boolean;
}> {}

const runJob = Effect.fn("worker.job.run")(function* (claimed: ClaimedJob) {
  const queue = yield* Queue;
  const { _tag: kind } = claimed.payload;
  const repositoryId = "repositoryId" in claimed.payload ? claimed.payload.repositoryId : null;

  const jobAttributes = { "job.id": claimed.id, "job.kind": kind, "job.attempt": claimed.attempts };

  const spanAttributes =
    repositoryId === null ? jobAttributes : { ...jobAttributes, "repository.id": repositoryId };

  const outcome = yield* handle(claimed).pipe(
    Effect.timeout("30 minutes"),
    Effect.raceFirst(heartbeatLoop(queue.heartbeat(claimed.id))),
    Effect.exit,
    Effect.flatMap((exit) =>
      Exit.isSuccess(exit)
        ? Effect.void
        : Effect.fail(
            new JobFailed({
              message: describeFailure(exit.cause),
              permanent: isPermanent(exit.cause),
            }),
          ),
    ),
    Effect.withSpan("worker.job", { attributes: spanAttributes }),
    Effect.result,
  );

  if (Result.isSuccess(outcome)) return yield* queue.complete(claimed.id);
  const { message, permanent } = outcome.failure;

  yield* Effect.logError("job failed", message).pipe(
    Effect.annotateLogs({ jobId: claimed.id, kind, repositoryId }),
  );
  yield* queue.fail(claimed, message, permanent);
});

const consumer = Effect.gen(function* () {
  const queue = yield* Queue;
  const claimed = yield* queue.claim;

  if (claimed === null) return yield* Effect.sleep("2 seconds");
  yield* runJob(claimed);
}).pipe(surviveFailure("worker iteration failed"), Effect.forever);

/** GitHub sends no event for reactions, so feedback runs on a timer. */
const housekeeping = Effect.gen(function* () {
  const queue = yield* Queue;
  yield* queue.enqueue(SyncFeedback.make({}));
  yield* queue.sweep;
  yield* sweepStuckReviews;
  yield* queue.prune;
}).pipe(
  surviveFailure("housekeeping failed"),
  Effect.repeat(Schedule.spaced(Duration.minutes(30))),
);

/** Kubernetes probes this; it answers while the database does. */
const health = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const context = yield* Effect.context<never>();

  const database = sql`select 1`.pipe(
    Effect.timeout("2 seconds"),
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

  yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        port: 8081,
        fetch: () =>
          Effect.runPromiseWith(context)(database).then(
            (ok) => new Response(ok ? "ok" : "db down", { status: ok ? 200 : 503 }),
          ),
      }),
    ),
    (server) => Effect.promise(() => server.stop()),
  );
  yield* Effect.never;
});

const Live = Layer.mergeAll(Indexer.layer, CodeSearch.layer, Queue.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(GitHub.layer, Claude.layer, Settings.layer, TreeSitter.layer)),
  Layer.provideMerge(Database.layer),
  Layer.provideMerge(Postgres.layer),
  Layer.provideMerge(Telemetry("nitpick-worker")),
);

const program = Effect.gen(function* () {
  const concurrency = yield* Config.Int("WORKER_CONCURRENCY").pipe(Config.withDefault(2));
  yield* Effect.logInfo("worker started", concurrency);
  yield* Effect.all(
    [health, housekeeping, ...Array.from({ length: concurrency }, () => consumer)],
    {
      concurrency: "unbounded",
      discard: true,
    },
  );
});

BunRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(Live)));

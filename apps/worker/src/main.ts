import { BunRuntime } from "@effect/platform-bun";
import { Claude } from "@nitpick/anthropic";
import { CodeSearch, Indexer } from "@nitpick/code-graph-server";
import { GitHub } from "@nitpick/github";
import { SyncFeedback } from "@nitpick/review-domain";
import { Database, Postgres } from "@nitpick/postgres";
import {
  type ClaimedJob,
  Queue,
  reviewPullRequest,
  Settings,
  syncFeedback,
  syncInstallation,
} from "@nitpick/review-server/worker";
import { TreeSitter } from "@nitpick/tree-sitter";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Schedule from "effect/Schedule";
import { SqlClient } from "effect/sql";

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

/** Whether retrying can help: bad input, oversized repositories and refusals stay as they are. */
const isPermanent = (error: {
  readonly _tag: string;
  readonly retryable?: boolean;
  readonly status?: number | null;
}) =>
  Match.value(error._tag).pipe(
    Match.when("ClaudeError", () => error.retryable === false),
    Match.when("GitHubError", () => error.status === 404 || error.status === 410),
    Match.whenOr("AgentError", "IndexTooLarge", "RepositoryNotFound", () => true),
    Match.orElse(() => false),
  );

const runJob = Effect.fn("worker.job.run")(function* (claimed: ClaimedJob) {
  const queue = yield* Queue;

  // Renews the lease while the job runs; losing the race interrupts it.
  const heartbeat = Effect.sleep("1 minute").pipe(
    Effect.andThen(queue.heartbeat(claimed.id)),
    Effect.forever,
  );

  const exit = yield* handle(claimed).pipe(
    Effect.timeout("30 minutes"),
    Effect.raceFirst(heartbeat),
    Effect.exit,
  );

  if (Exit.isSuccess(exit)) return yield* queue.complete(claimed.id);
  const failure = Cause.squash(exit.cause);

  // SAFETY: every failure here is a tagged error or a defect; a defect has neither field.
  const tagged = failure as {
    readonly _tag: string;
    readonly retryable?: boolean;
    readonly status?: number | null;
  };

  yield* Effect.logError("job failed", claimed.payload._tag, Cause.pretty(exit.cause));
  yield* queue.fail(claimed, Cause.pretty(exit.cause), isPermanent(tagged));
});

const consumer = Effect.gen(function* () {
  const queue = yield* Queue;
  const claimed = yield* queue.claim;

  if (claimed === null) return yield* Effect.sleep("2 seconds");
  yield* runJob(claimed);
}).pipe(Effect.forever);

/** GitHub sends no event for reactions, so feedback runs on a timer. */
const housekeeping = Effect.gen(function* () {
  const queue = yield* Queue;
  yield* queue.enqueue(SyncFeedback.make({}));
  yield* queue.prune;
}).pipe(Effect.repeat(Schedule.spaced(Duration.minutes(30))));

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

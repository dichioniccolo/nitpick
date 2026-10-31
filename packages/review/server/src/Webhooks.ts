import { createHmac, timingSafeEqual } from "node:crypto";
import { installation, repository } from "@nitpick/code-graph-tables";
import { Database } from "@nitpick/postgres";
import {
  IndexRepository,
  type JobPayload,
  type Json,
  ReviewPullRequest,
  SyncInstallation,
  TrustedAssociations,
} from "@nitpick/review-domain";
import { webhookDelivery } from "@nitpick/review-tables";
import { mentionOf } from "@nitpick/review-use-cases";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as S from "effect/Schema";

import { Queue } from "./Queue.ts";
import { Settings } from "./Settings.ts";

/** Constant-time check of GitHub's `X-Hub-Signature-256` over the raw body. */
export const verifySignature = (
  secret: string,
  body: string,
  signature: string | null,
): boolean => {
  if (signature === null) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const received = Buffer.from(signature);

  return expected.length === received.length && timingSafeEqual(expected, received);
};

const Account = S.Struct({ login: S.String, type: S.String });

const InstallationEvent = S.Struct({
  action: S.String,
  installation: S.Struct({ id: S.Number, account: Account }),
});

const InstallationRepositoriesEvent = S.Struct({ installation: S.Struct({ id: S.Number }) });

const PullRequestEvent = S.Struct({
  action: S.String,
  repository: S.Struct({ id: S.Number }),
  pull_request: S.Struct({ number: S.Number, head: S.Struct({ sha: S.String }) }),
});

const PushEvent = S.Struct({
  ref: S.String,
  repository: S.Struct({ id: S.Number, default_branch: S.String }),
});

const IssueCommentEvent = S.Struct({
  action: S.String,
  repository: S.Struct({ id: S.Number }),
  sender: S.Struct({ type: S.String }),
  issue: S.Struct({ number: S.Number, pull_request: S.optional(S.Unknown) }),
  comment: S.Struct({ id: S.Number, body: S.String, author_association: S.String }),
});

const decode = <A, I>(schema: S.Codec<A, I>, payload: Json): Effect.Effect<A, S.SchemaError> =>
  // SAFETY: these schemas are plain structs, which need no decoding services.
  S.decodeUnknownEffect(schema as S.Codec<A, unknown>)(payload);

const triggers = new Map<string, "opened" | "pushed">([
  ["opened", "opened"],
  ["reopened", "opened"],
  ["ready_for_review", "opened"],
  ["synchronize", "pushed"],
]);

/** The jobs one webhook event starts. Pure, apart from the bookkeeping on installations. */
const jobsFor = Effect.fnUntraced(function* (event: string, payload: Json) {
  const db = yield* Database;
  const { appSlug } = yield* Settings;
  const none: ReadonlyArray<JobPayload> = [];

  return yield* Match.value(event).pipe(
    Match.when("installation", () =>
      Effect.gen(function* () {
        const { action, installation: item } = yield* decode(InstallationEvent, payload);

        if (action === "deleted") {
          yield* db.delete(installation).where(eq(installation.id, item.id));

          return none;
        }

        const suspended = action === "suspend";
        yield* db
          .insert(installation)
          .values({
            id: item.id,
            accountLogin: item.account.login,
            accountType: item.account.type,
            suspended,
          })
          .onConflictDoUpdate({
            target: installation.id,
            set: { suspended, accountLogin: item.account.login },
          });

        return [SyncInstallation.make({ installationId: item.id })];
      }),
    ),
    Match.when("installation_repositories", () =>
      decode(InstallationRepositoriesEvent, payload).pipe(
        Effect.map(({ installation: item }): ReadonlyArray<JobPayload> => [
          SyncInstallation.make({ installationId: item.id }),
        ]),
      ),
    ),
    Match.when("pull_request", () =>
      decode(PullRequestEvent, payload).pipe(
        Effect.map(
          ({ action, repository: repo, pull_request: pull }): ReadonlyArray<JobPayload> => {
            const trigger = triggers.get(action);

            return trigger === undefined
              ? none
              : [
                  ReviewPullRequest.make({
                    repositoryId: repo.id,
                    prNumber: pull.number,
                    headSha: pull.head.sha,
                    trigger,
                  }),
                ];
          },
        ),
      ),
    ),
    Match.when("push", () =>
      decode(PushEvent, payload).pipe(
        Effect.map(({ ref, repository: repo }): ReadonlyArray<JobPayload> =>
          ref === `refs/heads/${repo.default_branch}`
            ? [IndexRepository.make({ repositoryId: repo.id })]
            : none,
        ),
      ),
    ),
    Match.when("issue_comment", () =>
      decode(IssueCommentEvent, payload).pipe(
        Effect.map(
          ({ action, repository: repo, sender, issue, comment }): ReadonlyArray<JobPayload> => {
            if (action !== "created" || issue.pull_request === undefined || sender.type === "Bot")
              return none;

            if (!TrustedAssociations.has(comment.author_association)) return none;
            const instruction = mentionOf(appSlug, comment.body);

            if (instruction === null) return none;

            if (instruction !== "" && !/^(re-?)?review\b/i.test(instruction)) return none;

            return [
              ReviewPullRequest.make({
                repositoryId: repo.id,
                prNumber: issue.number,
                headSha: "",
                trigger: "requested",
              }),
            ];
          },
        ),
      ),
    ),
    Match.orElse(() => Effect.succeed(none)),
  );
});

/**
 * Record the delivery and queue its jobs in one transaction: GitHub redelivers
 * on failure, and a delivery seen before does nothing. Jobs for a repository
 * this database does not hold yet are dropped, since nothing could run them.
 */
export const handleWebhook = Effect.fn("review.webhook.handle")(function* (
  deliveryId: string,
  event: string,
  payload: Json,
) {
  const db = yield* Database;
  const queue = yield* Queue;

  const known = (repositoryId: number) =>
    db.select({ id: repository.id }).from(repository).where(eq(repository.id, repositoryId));

  yield* db.transaction(() =>
    Effect.gen(function* () {
      const fresh = yield* db
        .insert(webhookDelivery)
        .values({ id: deliveryId })
        .onConflictDoNothing()
        .returning({ id: webhookDelivery.id });

      if (fresh.length === 0) return;

      const jobs = yield* jobsFor(event, payload).pipe(
        Effect.catchTag("SchemaError", (error) =>
          Effect.as(Effect.logWarning("webhook payload rejected", event, String(error)), []),
        ),
      );

      for (const item of jobs) {
        if ("repositoryId" in item && (yield* known(item.repositoryId)).length === 0) continue;
        yield* queue.enqueue(item);
      }
    }),
  );
});

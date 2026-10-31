import { describeFailure } from "@nitpick/github";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";

const backoff = Duration.seconds(5);
const heartbeatEvery = Duration.minutes(1);

/**
 * Log a failed iteration of a long-lived loop and back off, so a database blip
 * cannot end the process. Interruption passes through: that is a shutdown.
 */
export const surviveFailure =
  (message: string) =>
  <R>(iteration: Effect.Effect<void, never, R>): Effect.Effect<void, never, R> =>
    iteration.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logError(message, describeFailure(cause)).pipe(
              Effect.andThen(Effect.sleep(backoff)),
            ),
      ),
    );

/**
 * Renews a job's lease while it runs. Never ends, so it cannot win a race
 * against the job: a failed renewal is logged and the job carries on.
 */
export const heartbeatLoop = <R>(renew: Effect.Effect<void, never, R>) =>
  Effect.sleep(heartbeatEvery).pipe(
    Effect.andThen(renew),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning("heartbeat failed", describeFailure(cause)),
    ),
    Effect.forever,
  );

/** Whether retrying cannot help: bad input, oversized repositories and refusals stay as they are. */
export const isPermanent = (cause: Cause.Cause<unknown>): boolean => {
  const failure = Cause.squash(cause);
  const status = Predicate.hasProperty(failure, "status") ? failure.status : null;

  return Match.value(Predicate.hasProperty(failure, "_tag") ? failure._tag : null).pipe(
    Match.when("ClaudeError", () =>
      Predicate.hasProperty(failure, "retryable") ? failure.retryable === false : false,
    ),
    Match.when("GitHubError", () => status === 404 || status === 410),
    Match.whenOr("AgentError", "IndexTooLarge", "RepositoryNotFound", () => true),
    Match.orElse(() => false),
  );
};

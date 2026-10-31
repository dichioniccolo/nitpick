import { assert, describe, it } from "@effect/vitest";
import { ClaudeError } from "@nitpick/anthropic";
import { GitHubError } from "@nitpick/github";
import { AgentError } from "@nitpick/review-server/worker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { heartbeatLoop, isPermanent, surviveFailure } from "../src/loop.ts";

describe("worker loops", () => {
  it.effect("survives a defect, logs, and backs off five seconds", () =>
    Effect.gen(function* () {
      let runs = 0;

      const iteration = Effect.suspend(() => {
        runs += 1;

        return runs === 1 ? Effect.die(new Error("connection lost")) : Effect.never;
      });

      const fiber = yield* iteration.pipe(
        surviveFailure("iteration failed"),
        Effect.forever,
        Effect.forkChild,
      );

      yield* TestClock.adjust("4 seconds");
      assert.strictEqual(runs, 1);
      yield* TestClock.adjust("1 second");
      assert.strictEqual(runs, 2);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("lets interruption through", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.never.pipe(surviveFailure("x"), Effect.forkChild);
      yield* Effect.yieldNow;
      const exit = yield* Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)));
      assert.isTrue(Exit.isFailure(exit));
    }),
  );

  it.effect("a failing heartbeat cannot beat a healthy job", () =>
    Effect.gen(function* () {
      let renewals = 0;

      const renew = Effect.suspend(() => {
        renewals += 1;

        return Effect.die(new Error("connection lost"));
      });

      const job = Effect.sleep("3 minutes").pipe(Effect.as("done"));
      const fiber = yield* job.pipe(Effect.raceFirst(heartbeatLoop(renew)), Effect.forkChild);
      yield* TestClock.adjust("2 minutes");
      assert.strictEqual(renewals, 2);
      assert.isUndefined(fiber.pollUnsafe());
      yield* TestClock.adjust("1 minute");
      assert.strictEqual(yield* Fiber.join(fiber), "done");
    }),
  );

  it("treats only hopeless failures as permanent", () => {
    const claude = (retryable: boolean) =>
      new ClaudeError({ status: null, retryable, cause: null });

    const github = (status: number) => new GitHubError({ operation: "x", status, cause: null });

    assert.isTrue(isPermanent(Cause.fail(new AgentError({ reason: "refused" }))));
    assert.isTrue(isPermanent(Cause.fail(claude(false))));
    assert.isFalse(isPermanent(Cause.fail(claude(true))));
    assert.isTrue(isPermanent(Cause.fail(github(404))));
    assert.isFalse(isPermanent(Cause.fail(github(502))));
    assert.isFalse(isPermanent(Cause.die(null)));
    assert.isFalse(isPermanent(Cause.die(new Error("defect"))));
  });
});

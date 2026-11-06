import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as S from "effect/Schema";

import { request } from "../src/index.ts";

const Wire = S.Struct({ id: S.Number, user: S.NullOr(S.Struct({ login: S.String })) });

describe("request", () => {
  it.effect("decodes the answer, then maps it", () =>
    Effect.gen(function* () {
      const login = yield* request(
        "probe",
        Wire,
        () => Promise.resolve({ id: 1, user: { login: "dev" }, extra: true }),
        (data) => data.user?.login ?? null,
      );

      assert.strictEqual(login, "dev");
    }),
  );

  it.effect("fails a response that does not match as a GitHubError of the operation", () =>
    Effect.gen(function* () {
      const error = yield* request(
        "probe",
        Wire,
        () => Promise.resolve({ id: "1", user: null }),
        (data) => data.id,
      ).pipe(Effect.flip);

      assert.strictEqual(error._tag, "GitHubError");
      assert.strictEqual(error.operation, "probe");
      assert.isNull(error.status);
    }),
  );

  it.effect("aborts the HTTP request when the call is interrupted", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<AbortSignal>();

      const fiber = yield* Effect.forkChild(
        request(
          "probe",
          Wire,
          (signal) => {
            Deferred.doneUnsafe(started, Effect.succeed(signal));

            return new Promise<null>(() => {});
          },
          (data) => data.id,
        ),
      );

      const signal = yield* Deferred.await(started);
      assert.isFalse(signal.aborted);
      yield* Fiber.interrupt(fiber);
      assert.isTrue(signal.aborted);
    }),
  );
});

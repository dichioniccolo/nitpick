import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { userOfSession } from "../src/Session.ts";

describe("userOfSession", () => {
  it.effect("maps a session to a user", () =>
    Effect.gen(function* () {
      const user = yield* userOfSession(() =>
        Promise.resolve({ user: { id: "1", name: "a", image: null } }),
      );

      assert.deepStrictEqual(user, { id: "1", login: "a", avatarUrl: null });
    }),
  );

  it.effect("reads no session as no user", () =>
    Effect.gen(function* () {
      assert.isNull(yield* userOfSession(() => Promise.resolve(null)));
    }),
  );

  it.effect("reads a rejected lookup as no user, not a defect", () =>
    Effect.gen(function* () {
      assert.isNull(yield* userOfSession(() => Promise.reject(new Error("db down"))));
    }),
  );
});

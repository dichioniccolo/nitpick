import { assert, describe, it } from "@effect/vitest";
import * as A from "effect/Array";
import * as Effect from "effect/Effect";

import { accessibleRepositories, type Fetch, GitHubAccessFailed } from "../src/GitHubAccess.ts";

type Rows = ReadonlyArray<{ readonly id: number }>;

const json = (body: Readonly<Record<string, Rows | boolean>>, status = 200) =>
  Response.json(body, { status });

/** Answers one installation whose repositories come in the given page sizes. */
const walking = (pages: ReadonlyArray<number>) => {
  const seen: Array<string> = [];

  const fetch: Fetch = (url) => {
    seen.push(url);
    const page = /[?&]page=(\d+)/.exec(url)?.[1];

    if (page === undefined) return Promise.resolve(json({ installations: [{ id: 7 }] }));
    const size = pages[Number(page) - 1] ?? 0;

    return Promise.resolve(
      json({ repositories: A.makeBy(size, (index) => ({ id: Number(page) * 1000 + index })) }),
    );
  };

  return { fetch, seen };
};

const repositoryCalls = (seen: ReadonlyArray<string>) =>
  seen.filter((url) => url.includes("/repositories"));

describe("accessibleRepositories", () => {
  it.effect("continues after a full page of 100 and stops at a short one", () =>
    Effect.gen(function* () {
      const { fetch, seen } = walking([100, 100, 3]);
      const ids = yield* accessibleRepositories(fetch, "token");
      assert.lengthOf(ids, 203);
      assert.lengthOf(repositoryCalls(seen), 3);
    }),
  );

  it.effect("stops at once when the first page is under 100", () =>
    Effect.gen(function* () {
      const { fetch, seen } = walking([99]);
      assert.lengthOf(yield* accessibleRepositories(fetch, "token"), 99);
      assert.lengthOf(repositoryCalls(seen), 1);
    }),
  );

  it.effect("stops at 10 pages", () =>
    Effect.gen(function* () {
      const { fetch, seen } = walking(A.makeBy(12, () => 100));
      assert.lengthOf(yield* accessibleRepositories(fetch, "token"), 1000);
      assert.lengthOf(repositoryCalls(seen), 10);
    }),
  );

  it.effect("fails on a non-OK response", () =>
    Effect.gen(function* () {
      const fetch: Fetch = () => Promise.resolve(json({}, 403));
      const error = yield* Effect.flip(accessibleRepositories(fetch, "token"));
      assert.instanceOf(error, GitHubAccessFailed);
      assert.strictEqual(error.message, "GitHub answered 403 for /user/installations?per_page=100");
    }),
  );

  it.effect("fails on a non-OK page midway", () =>
    Effect.gen(function* () {
      const fetch: Fetch = (url) =>
        Promise.resolve(
          url.includes("/repositories") ? json({}, 502) : json({ installations: [{ id: 7 }] }),
        );

      const error = yield* Effect.flip(accessibleRepositories(fetch, "token"));
      assert.instanceOf(error, GitHubAccessFailed);
    }),
  );

  it.effect("fails on an unexpected body, and keeps the token out of the message", () =>
    Effect.gen(function* () {
      const fetch: Fetch = () => Promise.resolve(json({ nope: true }));
      const error = yield* Effect.flip(accessibleRepositories(fetch, "secret-token"));
      assert.instanceOf(error, GitHubAccessFailed);
      assert.notInclude(error.message, "secret-token");
    }),
  );
});

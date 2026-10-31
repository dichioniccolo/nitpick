import * as A from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

/** The part of `fetch` the walk uses, so a test can answer without a network. */
export type Fetch = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>> },
) => Promise<Response>;

/** Sign-in keeps the user's previous access when this fails; see `databaseHooks` in index.ts. */
export class GitHubAccessFailed extends Data.TaggedError("GitHubAccessFailed")<{
  readonly message: string;
}> {}

const Row = S.Struct({ id: S.Number });
const Installations = S.Struct({ installations: S.Array(Row) });
const Repositories = S.Struct({ repositories: S.Array(Row) });

/** GitHub caps pages at 100 rows; this bounds one sign-in to 1,000 repositories per installation. */
const maxPages = 10;
const pageSize = 100;

const get = <A>(fetch: Fetch, token: string, path: string, schema: S.Codec<A>) =>
  Effect.gen(function* () {
    const failed = (reason: string) =>
      new GitHubAccessFailed({ message: `GitHub ${reason} for ${path}` });

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`https://api.github.com${path}`, {
          headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
        }),
      catch: () => failed("could not be reached"),
    });

    if (!response.ok) return yield* failed(`answered ${response.status}`);

    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => failed("answered with invalid JSON"),
    });

    return yield* S.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => failed("answered with an unexpected shape")),
    );
  });

const installationRepositories = (fetch: Fetch, token: string, installationId: number) =>
  Effect.gen(function* () {
    let ids: ReadonlyArray<number> = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const { repositories } = yield* get(
        fetch,
        token,
        `/user/installations/${installationId}/repositories?per_page=${pageSize}&page=${page}`,
        Repositories,
      );

      ids = A.appendAll(
        ids,
        repositories.map((row) => row.id),
      );

      if (repositories.length < pageSize) break;
    }

    return ids;
  });

/** The ids of the repositories this GitHub user reaches through the App. */
export const accessibleRepositories = Effect.fn("identity.github.accessibleRepositories")(
  function* (fetch: Fetch, token: string) {
    const { installations } = yield* get(
      fetch,
      token,
      `/user/installations?per_page=${pageSize}`,
      Installations,
    );

    const walked = yield* Effect.forEach(installations, (item) =>
      installationRepositories(fetch, token, item.id),
    );

    return A.flatten(walked);
  },
);

import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as S from "effect/Schema";
import { App, RequestError } from "octokit";

export class GitHubError extends Data.TaggedError("GitHubError")<{
  readonly operation: string;
  readonly status: number | null;
  readonly cause: unknown;
}> {}

export interface RepoRef {
  readonly installationId: number;
  readonly owner: string;
  readonly repo: string;
}

export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly authorIsBot: boolean;
  readonly authorAssociation: string;
  readonly draft: boolean;
  readonly state: string;
  readonly labels: ReadonlyArray<string>;
  readonly headSha: string;
  readonly baseSha: string;
  readonly baseBranch: string;
}

export interface PullFile {
  readonly path: string;
  readonly status: string;
  readonly patch?: string | undefined;
}

export interface InlineComment {
  readonly path: string;
  readonly line: number;
  readonly startLine?: number | undefined;
  readonly body: string;
}

export interface PostedComment {
  readonly id: number;
  readonly body: string;
}

export interface InstallationRepository {
  readonly id: number;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly private: boolean;
}

/** A comment read back from GitHub. `author` is the login, `<slug>[bot]` for an App. */
export interface AuthoredComment extends PostedComment {
  readonly author: string;
}

export interface Reaction {
  readonly content: string;
  /** `null` for a deleted account. */
  readonly user: string | null;
}

/** One entry of a directory listing. */
export interface DirectoryEntry {
  readonly name: string;
  readonly type: "file" | "dir" | "symlink" | "submodule";
}

/** A commit on a pull request, oldest first. */
export interface PullCommit {
  readonly sha: string;
  readonly author: string | null;
  readonly message: string;
}

/** A check run's state. `conclusion` is set only once `status` is `completed`. */
export interface CheckRunState {
  readonly status: "in_progress" | "completed";
  readonly conclusion?: "success" | "failure" | "neutral" | "skipped" | undefined;
  readonly title: string;
  readonly summary: string;
  readonly detailsUrl?: string | undefined;
  readonly externalId?: string | undefined;
}

/** Everything the app does on GitHub. A narrow port, so tests swap it for a fake. */
export interface GitHubApi {
  readonly listRepositories: (
    installationId: number,
  ) => Effect.Effect<ReadonlyArray<InstallationRepository>, GitHubError>;
  readonly branchSha: (ref: RepoRef, branch: string) => Effect.Effect<string, GitHubError>;
  readonly repositorySizeKb: (ref: RepoRef) => Effect.Effect<number, GitHubError>;
  readonly tarball: (ref: RepoRef, sha: string) => Effect.Effect<Uint8Array, GitHubError>;
  readonly pullRequest: (ref: RepoRef, number: number) => Effect.Effect<PullRequest, GitHubError>;
  readonly pullFiles: (
    ref: RepoRef,
    number: number,
  ) => Effect.Effect<ReadonlyArray<PullFile>, GitHubError>;
  /** `null` for a missing file or a directory. */
  readonly fileText: (
    ref: RepoRef,
    path: string,
    sha: string,
  ) => Effect.Effect<string | null, GitHubError>;
  /** `null` when `path` is no directory at `sha`. The root is `""`. */
  readonly listDirectory: (
    ref: RepoRef,
    path: string,
    sha: string,
  ) => Effect.Effect<ReadonlyArray<DirectoryEntry> | null, GitHubError>;
  /** Up to 250 commits, the most GitHub lists for a pull request. */
  readonly pullCommits: (
    ref: RepoRef,
    number: number,
  ) => Effect.Effect<ReadonlyArray<PullCommit>, GitHubError>;
  /** Post one review. Returns GitHub's ids; a 422 means a line GitHub would not place. */
  readonly createReview: (
    ref: RepoRef,
    number: number,
    sha: string,
    comments: ReadonlyArray<InlineComment>,
  ) => Effect.Effect<ReadonlyArray<PostedComment>, GitHubError>;
  readonly upsertComment: (
    ref: RepoRef,
    number: number,
    commentId: number | null,
    body: string,
  ) => Effect.Effect<number, GitHubError>;
  /** Every inline review comment on the PR, for finding what an interrupted run posted. */
  readonly listReviewComments: (
    ref: RepoRef,
    number: number,
  ) => Effect.Effect<ReadonlyArray<AuthoredComment>, GitHubError>;
  /** Every conversation comment on the PR. */
  readonly listIssueComments: (
    ref: RepoRef,
    number: number,
  ) => Effect.Effect<ReadonlyArray<AuthoredComment>, GitHubError>;
  readonly commentReactions: (
    ref: RepoRef,
    commentId: number,
  ) => Effect.Effect<ReadonlyArray<Reaction>, GitHubError>;
  /** Create a check run on `headSha`. A 403 means the install has not granted Checks. */
  readonly createCheckRun: (
    ref: RepoRef,
    name: string,
    headSha: string,
    run: CheckRunState,
  ) => Effect.Effect<number, GitHubError>;
  readonly updateCheckRun: (
    ref: RepoRef,
    checkRunId: number,
    run: CheckRunState,
  ) => Effect.Effect<void, GitHubError>;
  /** `admin`, `maintain`, `write`, `triage`, `read` or `none`; `none` for an unknown user. */
  readonly userPermission: (ref: RepoRef, username: string) => Effect.Effect<string, GitHubError>;
}

const statusOf = (cause: unknown): number | null =>
  cause instanceof RequestError ? cause.status : null;

const repoOf = (fullName: string): Pick<RepoRef, "owner" | "repo"> => {
  const [owner = "", repo = ""] = fullName.split("/");

  return { owner, repo };
};

export const toRepoRef = (installationId: number, fullName: string): RepoRef => ({
  installationId,
  ...repoOf(fullName),
});

/**
 * A cause as its tag, plus operation and status when it has them. Never the
 * message: Drizzle error text carries query params, which hold repository source.
 */
export const describeFailure = (cause: Cause.Cause<unknown>): string => {
  if (Cause.hasInterruptsOnly(cause)) return "Interrupted";
  const failure = Cause.squash(cause);

  /** SQLSTATE and constraint from a query error's cause chain, never its message or parameters. */
  const postgresReason = (): ReadonlyArray<string> => {
    let current = failure;

    for (let depth = 0; depth < 5 && Predicate.hasProperty(current, "cause"); depth++) {
      current = current.cause;

      if (!Predicate.hasProperty(current, "code") || !Predicate.isString(current.code)) continue;

      if (!/^[0-9A-Z]{5}$/.test(current.code)) return [];

      return Predicate.hasProperty(current, "constraint") && Predicate.isString(current.constraint)
        ? [current.code, current.constraint]
        : [current.code];
    }

    return [];
  };

  const field = (key: string): ReadonlyArray<string> => {
    const value = Predicate.hasProperty(failure, key) ? failure[key] : null;

    return Predicate.isString(value) || Predicate.isNumber(value) ? [`${value}`] : [];
  };

  const name = failure instanceof Error ? failure.name : "Defect";
  const [tag = name] = field("_tag");

  return [tag, ...field("operation"), ...field("status"), ...postgresReason()].join(" ");
};

/** `run` gets the fiber's abort signal, so an interrupted call cancels its HTTP request. */
const call = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new GitHubError({ operation, status: statusOf(cause), cause }),
  }).pipe(Effect.withSpan(`github.${operation}`));

const toReviewComment = ({ path, line, startLine, body }: InlineComment) =>
  startLine === undefined
    ? { path, line, body, side: "RIGHT" }
    : { path, line, body, side: "RIGHT", start_line: startLine, start_side: "RIGHT" };

interface CheckRunParams {
  status: CheckRunState["status"];
  output: { title: string; summary: string };
  conclusion?: NonNullable<CheckRunState["conclusion"]>;
  details_url?: string;
  external_id?: string;
}

/** The REST fields of a check run, with an unset field left out rather than sent empty. */
const toCheckRun = (run: CheckRunState): CheckRunParams => {
  const params: CheckRunParams = {
    status: run.status,
    output: { title: run.title, summary: run.summary },
  };

  if (run.conclusion !== undefined) params.conclusion = run.conclusion;

  if (run.detailsUrl !== undefined) params.details_url = run.detailsUrl;

  if (run.externalId !== undefined) params.external_id = run.externalId;

  return params;
};

/**
 * GitHub's answers as they arrive. Octokit's types describe the API, but nothing checks a
 * response against them, so each is decoded here before the driver maps it. Unknown keys pass.
 */
const WireRepository = S.Struct({
  id: S.Number,
  full_name: S.String,
  default_branch: S.String,
  private: S.Boolean,
});

const WireBranch = S.Struct({ commit: S.Struct({ sha: S.String }) });
const WireRepositorySize = S.Struct({ size: S.Number });

/** The archive endpoints answer with binary: an ArrayBuffer from fetch, or a view of one. */
const WireBinary = S.Union([S.instanceOf(ArrayBuffer), S.instanceOf(Uint8Array)]);
const WireLogin = S.Struct({ login: S.String });

const WirePull = S.Struct({
  title: S.String,
  body: S.NullOr(S.String),
  user: S.Struct({ login: S.String, type: S.String }),
  author_association: S.String,
  draft: S.optionalKey(S.Boolean),
  state: S.String,
  labels: S.Array(S.Struct({ name: S.String })),
  head: S.Struct({ sha: S.String }),
  base: S.Struct({ sha: S.String, ref: S.String }),
});

const WireFile = S.Struct({
  filename: S.String,
  status: S.String,
  patch: S.optional(S.String),
});

const EntryType = S.Literals(["file", "dir", "symlink", "submodule"]);
const WireEntry = S.Struct({ name: S.String, type: S.String });

const WireCommit = S.Struct({
  sha: S.String,
  // GitHub can send `{}` for a commit whose email matches no account.
  author: S.optionalKey(S.NullOr(S.Struct({ login: S.optionalKey(S.String) }))),
  commit: S.Struct({ message: S.String }),
});

const WireId = S.Struct({ id: S.Number });
const WirePosted = S.Struct({ id: S.Number, body: S.String });

const WireComment = S.Struct({
  id: S.Number,
  body: S.optionalKey(S.NullOr(S.String)),
  user: S.NullOr(WireLogin),
});

const WireReaction = S.Struct({ content: S.String, user: S.NullOr(WireLogin) });
const WirePermission = S.Struct({ permission: S.String });

const toAuthored = (rows: ReadonlyArray<typeof WireComment.Type>): ReadonlyArray<AuthoredComment> =>
  rows.map((row) => ({ id: row.id, body: row.body ?? "", author: row.user?.login ?? "" }));

/**
 * A call whose answer is decoded against `wire`, then mapped. A response that does not match
 * fails as a `GitHubError` of the operation, with no status, rather than as a defect downstream.
 */
/** What Octokit answers before decoding: a body, raw text, or `null` for a 404 a call maps. */
export type RawResponse = object | string | null;

export const request = <W, A>(
  operation: string,
  wire: S.Decoder<W>,
  run: (signal: AbortSignal) => Promise<RawResponse>,
  map: (data: W) => A,
): Effect.Effect<A, GitHubError> => {
  const decode = S.decodeUnknownEffect(wire);

  return call(operation, run).pipe(
    Effect.flatMap((raw) =>
      decode(raw).pipe(
        Effect.mapError((cause) => new GitHubError({ operation, status: null, cause })),
      ),
    ),
    Effect.map(map),
  );
};

const PrivateKey = Config.Redacted("GITHUB_APP_PRIVATE_KEY");

export class GitHub extends Context.Service<GitHub, GitHubApi>()("@nitpick/github/GitHub") {
  static readonly layer = Layer.effect(
    GitHub,
    Effect.gen(function* () {
      const appId = yield* Config.String("GITHUB_APP_ID");
      const privateKey = yield* PrivateKey;

      const app = new App({
        appId,
        // Kubernetes secrets and .env files often carry the PEM with literal \n.
        privateKey: Redacted.value(privateKey).replaceAll("\\n", "\n"),
      });

      const client = (installationId: number) => app.getInstallationOctokit(installationId);

      const api: GitHubApi = {
        listRepositories: (installationId) =>
          request(
            "listRepositories",
            S.Array(WireRepository),
            async (signal) => {
              const octokit = await client(installationId);

              return octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, {
                request: { signal },
                per_page: 100,
              });
            },
            (rows) =>
              rows.map((row) => ({
                id: row.id,
                fullName: row.full_name,
                defaultBranch: row.default_branch,
                private: row.private,
              })),
          ),
        branchSha: (ref, branch) =>
          request(
            "branchSha",
            WireBranch,
            async (signal) =>
              (
                await (
                  await client(ref.installationId)
                ).rest.repos.getBranch({
                  request: { signal },
                  owner: ref.owner,
                  repo: ref.repo,
                  branch,
                })
              ).data,
            (data) => data.commit.sha,
          ),
        repositorySizeKb: (ref) =>
          request(
            "repositorySize",
            WireRepositorySize,
            async (signal) =>
              (
                await (
                  await client(ref.installationId)
                ).rest.repos.get({
                  request: { signal },
                  owner: ref.owner,
                  repo: ref.repo,
                })
              ).data,
            (data) => data.size,
          ),
        tarball: (ref, sha) =>
          request(
            "tarball",
            WireBinary,
            async (signal) => {
              const octokit = await client(ref.installationId);

              const { data } = await octokit.rest.repos.downloadTarballArchive({
                request: { signal },
                owner: ref.owner,
                repo: ref.repo,
                ref: sha,
              });

              // Octokit types the body as unknown; `WireBinary` rejects anything but bytes.
              return Predicate.isObject(data) ? data : null;
            },
            (data) => new Uint8Array(data),
          ),
        pullRequest: (ref, number) =>
          request(
            "pullRequest",
            WirePull,
            async (signal) =>
              (
                await (
                  await client(ref.installationId)
                ).rest.pulls.get({
                  request: { signal },
                  owner: ref.owner,
                  repo: ref.repo,
                  pull_number: number,
                })
              ).data,
            (data) => ({
              number,
              title: data.title,
              body: data.body ?? "",
              author: data.user.login,
              authorIsBot: data.user.type === "Bot",
              authorAssociation: data.author_association,
              draft: data.draft ?? false,
              state: data.state,
              labels: data.labels.map((label) => label.name),
              headSha: data.head.sha,
              baseSha: data.base.sha,
              baseBranch: data.base.ref,
            }),
          ),
        pullFiles: (ref, number) =>
          request(
            "pullFiles",
            S.Array(WireFile),
            async (signal) => {
              const octokit = await client(ref.installationId);

              return octokit.paginate(octokit.rest.pulls.listFiles, {
                request: { signal },
                owner: ref.owner,
                repo: ref.repo,
                pull_number: number,
                per_page: 100,
              });
            },
            (rows) =>
              rows.map((row) => ({ path: row.filename, status: row.status, patch: row.patch })),
          ),
        fileText: (ref, path, sha) =>
          request(
            "fileText",
            S.Unknown,
            async (signal) => {
              const octokit = await client(ref.installationId);

              try {
                const { data } = await octokit.rest.repos.getContent({
                  request: { signal },
                  owner: ref.owner,
                  repo: ref.repo,
                  path,
                  ref: sha,
                  mediaType: { format: "raw" },
                });

                return data;
              } catch (cause) {
                if (statusOf(cause) === 404) return null;
                throw cause;
              }
            },
            // A directory answers with a listing, not raw text; it reads as missing.
            (data) => (Predicate.isString(data) ? data : null),
          ),
        listDirectory: (ref, path, sha) =>
          request(
            "listDirectory",
            S.NullOr(S.Array(WireEntry)),
            async (signal) => {
              const octokit = await client(ref.installationId);

              try {
                const { data } = await octokit.rest.repos.getContent({
                  request: { signal },
                  owner: ref.owner,
                  repo: ref.repo,
                  path,
                  ref: sha,
                });

                // A file answers with one object; only a listing is a directory.
                return Array.isArray(data) ? data : null;
              } catch (cause) {
                if (statusOf(cause) === 404) return null;
                throw cause;
              }
            },
            (data) =>
              data?.map((entry) => ({
                name: entry.name,
                type: S.is(EntryType)(entry.type) ? entry.type : "file",
              })) ?? null,
          ),
        pullCommits: (ref, number) =>
          request(
            "pullCommits",
            S.Array(WireCommit),
            async (signal) => {
              const octokit = await client(ref.installationId);

              return octokit.paginate(octokit.rest.pulls.listCommits, {
                request: { signal },
                owner: ref.owner,
                repo: ref.repo,
                pull_number: number,
                per_page: 100,
              });
            },
            (rows) =>
              rows.map((row) => ({
                sha: row.sha,
                author: row.author?.login ?? null,
                message: row.commit.message,
              })),
          ),
        createReview: (ref, number, sha, comments) =>
          request(
            "createReview",
            S.Array(WirePosted),
            async (signal) => {
              const octokit = await client(ref.installationId);

              const { data } = await octokit.rest.pulls.createReview({
                request: { signal },
                owner: ref.owner,
                repo: ref.repo,
                pull_number: number,
                commit_id: sha,
                event: "COMMENT",
                comments: comments.map(toReviewComment),
              });

              return octokit.paginate(octokit.rest.pulls.listCommentsForReview, {
                request: { signal },
                owner: ref.owner,
                repo: ref.repo,
                pull_number: number,
                review_id: data.id,
                per_page: 100,
              });
            },
            (rows) => rows.map((row) => ({ id: row.id, body: row.body })),
          ),
        upsertComment: (ref, number, commentId, body) =>
          request(
            "upsertComment",
            WireId,
            async (signal) => {
              const octokit = await client(ref.installationId);

              if (commentId !== null) {
                try {
                  return (
                    await octokit.rest.issues.updateComment({
                      request: { signal },
                      owner: ref.owner,
                      repo: ref.repo,
                      comment_id: commentId,
                      body,
                    })
                  ).data;
                } catch (cause) {
                  // Someone deleted the comment; fall through and post a new one.
                  if (statusOf(cause) !== 404) throw cause;
                }
              }

              return (
                await octokit.rest.issues.createComment({
                  request: { signal },
                  owner: ref.owner,
                  repo: ref.repo,
                  issue_number: number,
                  body,
                })
              ).data;
            },
            (data) => data.id,
          ),
        listReviewComments: (ref, number) =>
          request(
            "listReviewComments",
            S.Array(WireComment),
            async (signal) => {
              const octokit = await client(ref.installationId);

              return octokit.paginate(octokit.rest.pulls.listReviewComments, {
                request: { signal },
                owner: ref.owner,
                repo: ref.repo,
                pull_number: number,
                per_page: 100,
              });
            },
            toAuthored,
          ),
        listIssueComments: (ref, number) =>
          request(
            "listIssueComments",
            S.Array(WireComment),
            async (signal) => {
              const octokit = await client(ref.installationId);

              return octokit.paginate(octokit.rest.issues.listComments, {
                request: { signal },
                owner: ref.owner,
                repo: ref.repo,
                issue_number: number,
                per_page: 100,
              });
            },
            toAuthored,
          ),
        commentReactions: (ref, commentId) =>
          request(
            "commentReactions",
            S.Array(WireReaction),
            async (signal) => {
              const octokit = await client(ref.installationId);

              return octokit.paginate(octokit.rest.reactions.listForPullRequestReviewComment, {
                request: { signal },
                owner: ref.owner,
                repo: ref.repo,
                comment_id: commentId,
                per_page: 100,
              });
            },
            (rows) => rows.map((row) => ({ content: row.content, user: row.user?.login ?? null })),
          ),
        createCheckRun: (ref, name, headSha, run) =>
          request(
            "createCheckRun",
            WireId,
            async (signal) =>
              (
                await (
                  await client(ref.installationId)
                ).rest.checks.create({
                  request: { signal },
                  owner: ref.owner,
                  repo: ref.repo,
                  name,
                  head_sha: headSha,
                  ...toCheckRun(run),
                })
              ).data,
            (data) => data.id,
          ),
        updateCheckRun: (ref, checkRunId, run) =>
          call("updateCheckRun", async (signal) => {
            const octokit = await client(ref.installationId);

            await octokit.rest.checks.update({
              request: { signal },
              owner: ref.owner,
              repo: ref.repo,
              check_run_id: checkRunId,
              ...toCheckRun(run),
            });
          }),
        userPermission: (ref, username) =>
          request(
            "userPermission",
            S.NullOr(WirePermission),
            async (signal) => {
              const octokit = await client(ref.installationId);

              try {
                return (
                  await octokit.rest.repos.getCollaboratorPermissionLevel({
                    request: { signal },
                    owner: ref.owner,
                    repo: ref.repo,
                    username,
                  })
                ).data;
              } catch (cause) {
                if (statusOf(cause) === 404) return null;
                throw cause;
              }
            },
            (data) => data?.permission ?? "none",
          ),
      };

      return api;
    }),
  );
}

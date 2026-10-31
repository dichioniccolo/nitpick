import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
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

  const field = (key: string): ReadonlyArray<string> => {
    const value = Predicate.hasProperty(failure, key) ? failure[key] : null;

    return Predicate.isString(value) || Predicate.isNumber(value) ? [`${value}`] : [];
  };

  const name = failure instanceof Error ? failure.name : "Defect";
  const [tag = name] = field("_tag");

  return [tag, ...field("operation"), ...field("status")].join(" ");
};

const call = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new GitHubError({ operation, status: statusOf(cause), cause }),
  }).pipe(Effect.withSpan(`github.${operation}`));

const toReviewComment = ({ path, line, startLine, body }: InlineComment) =>
  startLine === undefined
    ? { path, line, body, side: "RIGHT" }
    : { path, line, body, side: "RIGHT", start_line: startLine, start_side: "RIGHT" };

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
          call("listRepositories", async () => {
            const octokit = await client(installationId);

            const rows = await octokit.paginate(
              octokit.rest.apps.listReposAccessibleToInstallation,
              { per_page: 100 },
            );

            return rows.map((row) => ({
              id: row.id,
              fullName: row.full_name,
              defaultBranch: row.default_branch,
              private: row.private,
            }));
          }),
        branchSha: (ref, branch) =>
          call("branchSha", async () => {
            const octokit = await client(ref.installationId);

            const { data } = await octokit.rest.repos.getBranch({
              owner: ref.owner,
              repo: ref.repo,
              branch,
            });

            return data.commit.sha;
          }),
        repositorySizeKb: (ref) =>
          call("repositorySize", async () => {
            const octokit = await client(ref.installationId);
            const { data } = await octokit.rest.repos.get({ owner: ref.owner, repo: ref.repo });

            return data.size;
          }),
        tarball: (ref, sha) =>
          call("tarball", async () => {
            const octokit = await client(ref.installationId);

            const { data } = await octokit.rest.repos.downloadTarballArchive({
              owner: ref.owner,
              repo: ref.repo,
              ref: sha,
            });

            // SAFETY: the archive endpoints answer with binary, which octokit returns as an ArrayBuffer.
            return new Uint8Array(data as ArrayBuffer);
          }),
        pullRequest: (ref, number) =>
          call("pullRequest", async () => {
            const octokit = await client(ref.installationId);

            const { data } = await octokit.rest.pulls.get({
              owner: ref.owner,
              repo: ref.repo,
              pull_number: number,
            });

            return {
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
            };
          }),
        pullFiles: (ref, number) =>
          call("pullFiles", async () => {
            const octokit = await client(ref.installationId);

            const rows = await octokit.paginate(octokit.rest.pulls.listFiles, {
              owner: ref.owner,
              repo: ref.repo,
              pull_number: number,
              per_page: 100,
            });

            return rows.map((row) => ({
              path: row.filename,
              status: row.status,
              patch: row.patch,
            }));
          }),
        fileText: (ref, path, sha) =>
          call("fileText", async () => {
            const octokit = await client(ref.installationId);

            try {
              const { data } = await octokit.rest.repos.getContent({
                owner: ref.owner,
                repo: ref.repo,
                path,
                ref: sha,
                mediaType: { format: "raw" },
              });

              return Predicate.isString(data) ? data : null;
            } catch (cause) {
              if (statusOf(cause) === 404) return null;
              throw cause;
            }
          }),
        createReview: (ref, number, sha, comments) =>
          call("createReview", async () => {
            const octokit = await client(ref.installationId);

            const { data } = await octokit.rest.pulls.createReview({
              owner: ref.owner,
              repo: ref.repo,
              pull_number: number,
              commit_id: sha,
              event: "COMMENT",
              comments: comments.map(toReviewComment),
            });

            const posted = await octokit.paginate(octokit.rest.pulls.listCommentsForReview, {
              owner: ref.owner,
              repo: ref.repo,
              pull_number: number,
              review_id: data.id,
              per_page: 100,
            });

            return posted.map((comment) => ({ id: comment.id, body: comment.body }));
          }),
        upsertComment: (ref, number, commentId, body) =>
          call("upsertComment", async () => {
            const octokit = await client(ref.installationId);

            if (commentId !== null) {
              try {
                await octokit.rest.issues.updateComment({
                  owner: ref.owner,
                  repo: ref.repo,
                  comment_id: commentId,
                  body,
                });

                return commentId;
              } catch (cause) {
                // Someone deleted the comment; fall through and post a new one.
                if (statusOf(cause) !== 404) throw cause;
              }
            }

            const { data } = await octokit.rest.issues.createComment({
              owner: ref.owner,
              repo: ref.repo,
              issue_number: number,
              body,
            });

            return data.id;
          }),
        listReviewComments: (ref, number) =>
          call("listReviewComments", async () => {
            const octokit = await client(ref.installationId);

            const rows = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
              owner: ref.owner,
              repo: ref.repo,
              pull_number: number,
              per_page: 100,
            });

            return rows.map((row) => ({
              id: row.id,
              body: row.body,
              author: row.user?.login ?? "",
            }));
          }),
        listIssueComments: (ref, number) =>
          call("listIssueComments", async () => {
            const octokit = await client(ref.installationId);

            const rows = await octokit.paginate(octokit.rest.issues.listComments, {
              owner: ref.owner,
              repo: ref.repo,
              issue_number: number,
              per_page: 100,
            });

            return rows.map((row) => ({
              id: row.id,
              body: row.body ?? "",
              author: row.user?.login ?? "",
            }));
          }),
        commentReactions: (ref, commentId) =>
          call("commentReactions", async () => {
            const octokit = await client(ref.installationId);

            const rows = await octokit.paginate(
              octokit.rest.reactions.listForPullRequestReviewComment,
              { owner: ref.owner, repo: ref.repo, comment_id: commentId, per_page: 100 },
            );

            return rows.map((row) => ({ content: row.content, user: row.user?.login ?? null }));
          }),
        userPermission: (ref, username) =>
          call("userPermission", async () => {
            const octokit = await client(ref.installationId);

            try {
              const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
                owner: ref.owner,
                repo: ref.repo,
                username,
              });

              return data.permission;
            } catch (cause) {
              if (statusOf(cause) === 404) return "none";
              throw cause;
            }
          }),
      };

      return api;
    }),
  );
}

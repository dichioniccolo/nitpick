import * as S from "effect/Schema";

/** A parsed JSON value: webhook bodies and tool inputs before their schema decodes them. */
export type Json =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

export const Severity = S.Literals(["critical", "major", "minor"]);

export type Severity = typeof Severity.Type;

export const Category = S.Literals([
  "logic",
  "security",
  "performance",
  "reliability",
  "style",
  "rule",
]);

export type Category = typeof Category.Type;

/** One issue the agent raises. `startLine`/`line` are new-file lines in the PR's diff. */
export const FindingDraft = S.Struct({
  path: S.String,
  startLine: S.optional(S.Number),
  line: S.Number,
  severity: Severity,
  category: Category,
  title: S.String,
  body: S.String,
  suggestion: S.optional(S.String),
});

export type FindingDraft = typeof FindingDraft.Type;

/** The `submit_review` tool's input. */
export const ReviewDraft = S.Struct({
  summary: S.String,
  confidence: S.Number,
  diagram: S.optional(S.String),
  findings: S.Array(FindingDraft),
});

export type ReviewDraft = typeof ReviewDraft.Type;

export const Strictness = S.Literals(["strict", "balanced", "relaxed"]);

export type Strictness = typeof Strictness.Type;

/** A bounded list, so a config cannot inflate every prompt or the glob work per file. */
const cappedStrings = (maxItemLength: number) =>
  S.Array(S.String.check(S.isMaxLength(maxItemLength))).check(S.isMaxLength(50));

/** `.nitpick.json` at the repository root. Every field is optional. */
export const RepoConfig = S.Struct({
  strictness: S.optionalKey(Strictness),
  triggerOnUpdates: S.optionalKey(S.Boolean),
  skipDrafts: S.optionalKey(S.Boolean),
  ignorePaths: S.optionalKey(cappedStrings(200)),
  ignoreAuthors: S.optionalKey(cappedStrings(255)),
  skipLabels: S.optionalKey(cappedStrings(255)),
  baseBranches: S.optionalKey(cappedStrings(255)),
  rules: S.optionalKey(cappedStrings(2000)),
  maxFindings: S.optionalKey(S.Int.check(S.isBetween({ minimum: 1, maximum: 50 }))),
  diagram: S.optionalKey(S.Boolean),
});

export type RepoConfig = typeof RepoConfig.Type;

export type ResolvedConfig = { readonly [K in keyof RepoConfig]-?: NonNullable<RepoConfig[K]> };

export const ResolvedConfig: ResolvedConfig = {
  strictness: "balanced",
  triggerOnUpdates: false,
  skipDrafts: true,
  ignorePaths: [],
  ignoreAuthors: [],
  skipLabels: ["no-review"],
  baseBranches: [],
  rules: [],
  maxFindings: 15,
  diagram: true,
};

export const resolveConfig = (config: RepoConfig): ResolvedConfig => ({
  ...ResolvedConfig,
  ...config,
});

/** Queue payloads. `kind` also names the job row. */
export const SyncInstallation = S.TaggedStruct("SyncInstallation", { installationId: S.Number });
export const IndexRepository = S.TaggedStruct("IndexRepository", { repositoryId: S.Number });

export const ReviewPullRequest = S.TaggedStruct("ReviewPullRequest", {
  repositoryId: S.Number,
  prNumber: S.Number,
  /** Empty for `requested`: the reviewer uses the PR's current head. */
  headSha: S.String,
  trigger: S.Literals(["opened", "pushed", "requested"]),
});

export const SyncFeedback = S.TaggedStruct("SyncFeedback", {});

export const JobPayload = S.Union([
  SyncInstallation,
  IndexRepository,
  ReviewPullRequest,
  SyncFeedback,
]);

export type JobPayload = typeof JobPayload.Type;

/** Who may spend the owner's API budget by opening a PR or mentioning the App. */
export const TrustedAssociations: ReadonlySet<string> = new Set([
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
]);

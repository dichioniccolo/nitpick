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

/** How much the change matters, shown as `[High impact]` before the verdict. */
export const Impact = S.Literals(["low", "medium", "high"]);

export type Impact = typeof Impact.Type;

/** The `submit_review` tool's input. */
export const ReviewDraft = S.Struct({
  impact: Impact,
  verdict: S.String,
  summary: S.String,
  changes: S.Array(S.String),
  confidence: S.Number,
  diagram: S.optional(S.String),
  findings: S.Array(FindingDraft),
});

export type ReviewDraft = typeof ReviewDraft.Type;

export const Strictness = S.Literals(["strict", "balanced", "relaxed"]);

export type Strictness = typeof Strictness.Type;

/** The lowest severity that fails the check; `never` makes the check report only. */
export const FailOn = S.Literals(["critical", "major", "minor", "never"]);

export type FailOn = typeof FailOn.Type;

/** What a `nitpick` check run ends with. Errors are `neutral`, so an outage never blocks a merge. */
export const CheckConclusion = S.Literals(["success", "failure", "neutral", "skipped"]);

export type CheckConclusion = typeof CheckConclusion.Type;

/** The `checks` block of `.nitpick.json`. */
export const ChecksConfig = S.Struct({
  enabled: S.optionalKey(S.Boolean),
  failOn: S.optionalKey(FailOn),
});

export type ChecksConfig = typeof ChecksConfig.Type;

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
  checks: S.optionalKey(ChecksConfig),
});

export type RepoConfig = typeof RepoConfig.Type;

export type ResolvedChecks = { readonly [K in keyof ChecksConfig]-?: NonNullable<ChecksConfig[K]> };

export type ResolvedConfig = {
  readonly [K in Exclude<keyof RepoConfig, "checks">]-?: NonNullable<RepoConfig[K]>;
} & { readonly checks: ResolvedChecks };

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
  checks: { enabled: true, failOn: "critical" },
};

/** Defaults under the file's values. `checks` merges by key, so `{ "failOn": "major" }` keeps it enabled. */
export const resolveConfig = (config: RepoConfig): ResolvedConfig => ({
  ...ResolvedConfig,
  ...config,
  checks: { ...ResolvedConfig.checks, ...config.checks },
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

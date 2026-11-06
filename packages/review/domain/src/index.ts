import * as S from "effect/Schema";

/** A parsed JSON value: webhook bodies and tool inputs before their schema decodes them. */
export type Json =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

/** P0 is the most severe: catastrophic failure, a critical vulnerability or wide data loss. P3 is a minor issue. */
export const Severity = S.Literals(["P0", "P1", "P2", "P3"]);

export type Severity = typeof Severity.Type;

/** Severity names before P0-P3. `.nitpick.json` files still carry them in `checks.failOn`. */
export const LegacySeverity = S.Literals(["critical", "major", "minor"]);

export type LegacySeverity = typeof LegacySeverity.Type;

export const severityFromLegacy: Readonly<Record<LegacySeverity, Severity>> = {
  critical: "P0",
  major: "P1",
  minor: "P2",
};

export const Category = S.Literals([
  "logic",
  "security",
  "performance",
  "reliability",
  "style",
  "testing",
  "rule",
]);

export type Category = typeof Category.Type;

/** How sure a reviewer is that a finding is real, before the verifier checks it. */
export const FindingConfidence = S.Literals(["low", "medium", "high"]);

export type FindingConfidence = typeof FindingConfidence.Type;

/**
 * One issue a reviewer raises. `startLine`/`line` are new-file lines in the PR's diff. `scenario`
 * is the input or state that triggers it; `evidence` names the code that proves it.
 */
export const FindingDraft = S.Struct({
  path: S.String,
  startLine: S.optional(S.Number),
  line: S.Number,
  severity: Severity,
  category: Category,
  title: S.String,
  body: S.String,
  scenario: S.String,
  evidence: S.String,
  confidence: FindingConfidence,
  suggestion: S.optional(S.String),
});

export type FindingDraft = typeof FindingDraft.Type;

/** The reviewers that run in parallel on every PR, one focus each. */
export const Specialist = S.Literals(["logic", "security", "architecture", "tests"]);

export type Specialist = typeof Specialist.Type;

/** A specialist's `submit_findings` input. */
export const FindingsDraft = S.Struct({ findings: S.Array(FindingDraft) });

export type FindingsDraft = typeof FindingsDraft.Type;

/** The verifier's call on one candidate. `severity` may only lower it. */
export const FindingVerdict = S.Struct({
  id: S.Int,
  decision: S.Literals(["confirmed", "rejected"]),
  reason: S.String,
  severity: S.optional(Severity),
});

export type FindingVerdict = typeof FindingVerdict.Type;

/** How much the change matters, shown as `[High impact]` before the verdict. */
export const Impact = S.Literals(["low", "medium", "high"]);

export type Impact = typeof Impact.Type;

/** The verifier's `submit_review` input: the summary, plus a verdict per candidate finding. */
export const VerifiedReview = S.Struct({
  impact: Impact,
  verdict: S.String,
  summary: S.String,
  changes: S.Array(S.String),
  diagram: S.optional(S.String),
  verdicts: S.Array(FindingVerdict),
});

export type VerifiedReview = typeof VerifiedReview.Type;

export const Strictness = S.Literals(["strict", "balanced", "relaxed"]);

export type Strictness = typeof Strictness.Type;

/**
 * The lowest severity that fails the check. `never` makes the check report only: unless the file
 * also sets `minConfidence`, the confidence rule is off too.
 */
export const FailOn = S.Literals(["P0", "P1", "P2", "P3", "never"]);

export type FailOn = typeof FailOn.Type;

/** What `checks.failOn` accepts: P0-P3, `never`, or a legacy name that `resolveConfig` maps. */
export const FailOnInput = S.Union([FailOn, LegacySeverity]);

export type FailOnInput = typeof FailOnInput.Type;

/** What a `nitpick` check run ends with. Errors are `neutral`, so an outage never blocks a merge. */
export const CheckConclusion = S.Literals(["success", "failure", "neutral", "skipped"]);

export type CheckConclusion = typeof CheckConclusion.Type;

/** The `checks` block of `.nitpick.json`. */
export const ChecksConfig = S.Struct({
  enabled: S.optionalKey(S.Boolean),
  failOn: S.optionalKey(FailOnInput),
  /** The check fails below this confidence score; 1 turns the rule off. */
  minConfidence: S.optionalKey(S.Int.check(S.isBetween({ minimum: 1, maximum: 5 }))),
});

export type ChecksConfig = typeof ChecksConfig.Type;

/** A bounded list, so a config cannot inflate every prompt or the glob work per file. */
const cappedStrings = (maxItemLength: number) =>
  S.Array(S.String.check(S.isMaxLength(maxItemLength))).check(S.isMaxLength(50));

/** `.nitpick.json` at the repository root. Every field is optional. */
export const RepoConfig = S.Struct({
  strictness: S.optionalKey(Strictness),
  /** Review when a PR opens, reopens or leaves draft. Off: only a mention or a check re-run reviews. */
  triggerOnOpen: S.optionalKey(S.Boolean),
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

export type ResolvedChecks = {
  readonly enabled: boolean;
  readonly failOn: FailOn;
  readonly minConfidence: number;
};

export type ResolvedConfig = {
  readonly [K in Exclude<keyof RepoConfig, "checks">]-?: NonNullable<RepoConfig[K]>;
} & { readonly checks: ResolvedChecks };

export const ResolvedConfig: ResolvedConfig = {
  strictness: "balanced",
  triggerOnOpen: false,
  triggerOnUpdates: false,
  skipDrafts: true,
  ignorePaths: [],
  ignoreAuthors: [],
  skipLabels: ["no-review"],
  baseBranches: [],
  rules: [],
  maxFindings: 15,
  diagram: true,
  checks: { enabled: true, failOn: "P0", minConfidence: 5 },
};

const resolveFailOn = (failOn: FailOnInput): FailOn =>
  S.is(LegacySeverity)(failOn) ? severityFromLegacy[failOn] : failOn;

/** Defaults under the file's values. `checks` merges by key, so `{ "failOn": "P1" }` keeps it enabled. */
export const resolveConfig = (config: RepoConfig): ResolvedConfig => {
  const { checks, ...rest } = config;
  const failOn = checks?.failOn;

  return {
    ...ResolvedConfig,
    ...rest,
    checks: {
      ...ResolvedConfig.checks,
      // A repo that chose "never fail" keeps a report-only check when the confidence rule arrived.
      ...(failOn === "never" ? { minConfidence: 1 } : undefined),
      ...checks,
      failOn: failOn === undefined ? ResolvedConfig.checks.failOn : resolveFailOn(failOn),
    },
  };
};

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

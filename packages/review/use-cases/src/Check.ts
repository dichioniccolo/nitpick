import type { CheckConclusion, FailOn, Severity } from "@nitpick/review-domain";

import { severityRank } from "./Findings.ts";
import { clampConfidence, sanitize, severityCounts } from "./Render.ts";

/** The check run's name. Teams require it by name in branch protection, so it never changes. */
export const checkName = "nitpick";

/** GitHub caps a check run's `output.summary` at 65535 characters. */
const maxSummary = 65_535;

export interface CheckOutput {
  readonly title: string;
  readonly summary: string;
}

export interface CheckGate {
  readonly failOn: FailOn;
  /** 1 to 5; a confidence score below it fails the check. */
  readonly minConfidence: number;
}

/** `failure` when the confidence score is below `minConfidence` or a published finding reaches `failOn`. */
export const checkConclusion = (
  findings: ReadonlyArray<{ readonly severity: Severity }>,
  confidence: number,
  gate: CheckGate,
): "success" | "failure" => {
  const unsure = clampConfidence(confidence) < gate.minConfidence;

  const { failOn } = gate;

  const blocking =
    failOn !== "never" &&
    findings.some((finding) => severityRank[finding.severity] <= severityRank[failOn]);

  return unsure || blocking ? "failure" : "success";
};

/** Cut at the limit with a note, so a long summary never makes GitHub reject the update. */
export const truncateSummary = (summary: string): string => {
  if (summary.length <= maxSummary) return summary;
  const note = "\n\n…truncated.";

  return `${summary.slice(0, maxSummary - note.length)}${note}`;
};

const countsOf = (findings: ReadonlyArray<{ readonly severity: Severity }>): string => {
  const counts = severityCounts(findings);

  return counts.length > 0 ? counts.join(", ") : "No issues found";
};

const gateOf = ({ failOn, minConfidence }: CheckGate): string => {
  const findings =
    failOn === "never" ? [] : [failOn === "P0" ? "P0 findings" : `${failOn} findings or worse`];

  const confidence = minConfidence > 1 ? [`a confidence score below ${minConfidence}/5`] : [];
  const rules = [...findings, ...confidence];

  return rules.length === 0
    ? "This check reports only; it never fails."
    : `Fails on ${rules.join(" or ")}.`;
};

export const runningCheckOutput = (reviewUrl: string): CheckOutput => ({
  title: "Reviewing",
  summary: `Nitpick is reviewing this commit. [Open in Nitpick](${reviewUrl})`,
});

export interface CompletedCheckInput {
  readonly summary: string;
  readonly confidence: number;
  readonly findings: ReadonlyArray<{ readonly severity: Severity }>;
  readonly gate: CheckGate;
  readonly reviewUrl: string;
}

/** The finished review: counts in the title, then the summary, the gate and a link. */
export const completedCheckOutput = (input: CompletedCheckInput): CheckOutput => ({
  title: countsOf(input.findings),
  summary: truncateSummary(
    [
      sanitize(input.summary),
      `**Confidence Score: ${clampConfidence(input.confidence)}/5** · ${gateOf(input.gate)}`,
      `[Open in Nitpick](${input.reviewUrl})`,
    ].join("\n\n"),
  ),
});

export const failedCheckOutput = (reviewUrl: string): CheckOutput => ({
  title: "Review failed",
  summary: `Nitpick could not finish this review, so the check does not block the merge. Re-run it from here or comment \`@nitpick review\`. [Open in Nitpick](${reviewUrl})`,
});

export const skippedCheckOutput = (reason: string): CheckOutput => ({
  title: "Skipped",
  summary: `Nitpick did not review this pull request: ${sanitize(reason)}. Re-run this check to review it anyway.`,
});

/** A head nitpick did not review keeps the result of the last commit it did. */
export const carriedCheckOutput = (fromSha: string, conclusion: CheckConclusion): CheckOutput => ({
  title: `Carried from ${fromSha.slice(0, 7)}: ${conclusion}`,
  summary: `Nitpick did not review this commit, so this is the result for ${fromSha.slice(0, 7)}. Re-run this check to review this commit.`,
});

/** A finished review's check result, as `resultToCarry` weighs it. */
export interface StoredResult {
  readonly prNumber: number;
  readonly headSha: string;
  readonly baseSha: string;
  readonly conclusion: CheckConclusion;
}

/**
 * The stored result a head nitpick does not review shows, from rows of this PR and of this
 * commit on any PR, newest first. Check runs belong to the commit, so whatever is posted shows
 * on every PR with that head.
 *
 * - `commit`: this commit's own result. Any failure on it wins, so no later run clears one.
 *   Otherwise this PR's own result, then another PR's when it had the same base commit; a pass
 *   judged against another base does not carry.
 * - `pull`: the newest result of this PR, on any head. A push nitpick skips keeps it.
 */
export interface CarriedResults {
  readonly commit: StoredResult | undefined;
  readonly pull: StoredResult | undefined;
}

export const resultToCarry = (
  rows: ReadonlyArray<StoredResult>,
  pull: { readonly number: number; readonly headSha: string; readonly baseSha: string },
): CarriedResults => {
  const commit = rows.filter((row) => row.headSha === pull.headSha);

  return {
    commit:
      commit.find((row) => row.conclusion === "failure") ??
      commit.find((row) => row.prNumber === pull.number) ??
      commit.find((row) => row.baseSha === pull.baseSha),
    pull: rows.find((row) => row.prNumber === pull.number),
  };
};

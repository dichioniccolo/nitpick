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

/** `failure` when a published finding is at or above `failOn`, else `success`. */
export const checkConclusion = (
  findings: ReadonlyArray<{ readonly severity: Severity }>,
  failOn: FailOn,
): "success" | "failure" =>
  failOn !== "never" &&
  findings.some((finding) => severityRank[finding.severity] <= severityRank[failOn])
    ? "failure"
    : "success";

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

const gateOf = (failOn: FailOn): string =>
  failOn === "never"
    ? "This check reports only; findings never fail it."
    : `Fails on ${failOn === "critical" ? "critical findings" : `${failOn} findings or worse`}.`;

export const runningCheckOutput = (reviewUrl: string): CheckOutput => ({
  title: "Reviewing",
  summary: `Nitpick is reviewing this commit. [Open in Nitpick](${reviewUrl})`,
});

export interface CompletedCheckInput {
  readonly summary: string;
  readonly confidence: number;
  readonly findings: ReadonlyArray<{ readonly severity: Severity }>;
  readonly failOn: FailOn;
  readonly reviewUrl: string;
}

/** The finished review: counts in the title, then the summary, the gate and a link. */
export const completedCheckOutput = (input: CompletedCheckInput): CheckOutput => ({
  title: countsOf(input.findings),
  summary: truncateSummary(
    [
      sanitize(input.summary),
      `**Confidence to merge: ${clampConfidence(input.confidence)}/5** · ${gateOf(input.failOn)}`,
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

/** A push nitpick did not review keeps the result of the last commit it did. */
export const carriedCheckOutput = (fromSha: string, conclusion: CheckConclusion): CheckOutput => ({
  title: `Carried from ${fromSha.slice(0, 7)}: ${conclusion}`,
  summary: `Reviews on new pushes are off, so this is the result for ${fromSha.slice(0, 7)}. Re-run this check to review this commit.`,
});

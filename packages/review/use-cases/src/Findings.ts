import { createHash } from "node:crypto";
import * as Match from "effect/Match";
import type { FindingDraft, ResolvedConfig, Severity, Strictness } from "@nitpick/review-domain";

import { commentableLines, isIgnored, type PullFile } from "./Diff.ts";

export interface PlacedFinding extends FindingDraft {
  readonly fingerprint: string;
}

/** Worst first: a lower rank is more severe. */
export const severityRank: Readonly<Record<Severity, number>> = { critical: 0, major: 1, minor: 2 };

const floor: Readonly<Record<Strictness, Severity>> = {
  strict: "minor",
  balanced: "major",
  relaxed: "critical",
};

/** Same path, category and title reads as the same finding when line numbers shift between pushes. */
export const fingerprintOf = (finding: Pick<FindingDraft, "path" | "category" | "title">): string =>
  createHash("sha256")
    .update(
      `${finding.path}\0${finding.category}\0${finding.title.toLowerCase().replace(/\W+/g, " ").trim()}`,
    )
    .digest("hex")
    .slice(0, 16);

/**
 * Keep the findings GitHub can place and the team wants: on a diff line, in a
 * path that is not ignored, above the strictness floor, not raised before on
 * this PR. Rule breaches pass the floor, since a team wrote the rule. Worst
 * first, capped at `maxFindings`.
 */
export const selectFindings = (
  drafts: ReadonlyArray<FindingDraft>,
  files: ReadonlyArray<PullFile>,
  config: ResolvedConfig,
  known: ReadonlySet<string>,
): ReadonlyArray<PlacedFinding> => {
  const lines = new Map(files.map((file) => [file.path, commentableLines(file.patch ?? "")]));
  const seen = new Set(known);
  const kept: Array<PlacedFinding> = [];

  for (const draft of drafts) {
    const onDiff = lines.get(draft.path);

    if (onDiff === undefined || !onDiff.has(draft.line)) continue;

    if (isIgnored(draft.path, config.ignorePaths)) continue;

    if (
      draft.category !== "rule" &&
      severityRank[draft.severity] > severityRank[floor[config.strictness]]
    )
      continue;
    const fingerprint = fingerprintOf(draft);

    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    // A multi-line comment needs both ends in one hunk; a start GitHub would reject is dropped.
    const { startLine, ...rest } = draft;
    const validStart = startLine !== undefined && startLine < draft.line && onDiff.has(startLine);
    kept.push({ ...rest, startLine: validStart ? startLine : undefined, fingerprint });
  }

  return kept
    .toSorted((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, config.maxFindings);
};

/**
 * The confidence score, from the findings the PR actually shows: 5 with none, 4 with minors only,
 * 3 with one major, 2 with several, 1 with any critical. Findings the strictness floor, the noise
 * list or a repeat dropped never lower it, so a review that posts nothing always reads 5/5.
 */
export const confidenceOf = (findings: ReadonlyArray<{ readonly severity: Severity }>): number => {
  const count = (severity: Severity) =>
    findings.filter((finding) => finding.severity === severity).length;

  return Match.value({
    critical: count("critical"),
    major: count("major"),
    minor: count("minor"),
  }).pipe(
    Match.when({ critical: (n) => n > 0 }, () => 1),
    Match.when({ major: (n) => n > 1 }, () => 2),
    Match.when({ major: 1 }, () => 3),
    Match.when({ minor: (n) => n > 0 }, () => 4),
    Match.orElse(() => 5),
  );
};

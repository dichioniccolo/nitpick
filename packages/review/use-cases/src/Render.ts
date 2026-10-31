import type { Severity } from "@nitpick/review-domain";

import type { PlacedFinding } from "./Findings.ts";

export const summaryMarker = "<!-- nitpick:summary -->";

export const findingMarker = (fingerprint: string): string =>
  `<!-- nitpick:finding:${fingerprint} -->`;

export const fingerprintFromBody = (body: string): string | null =>
  /<!-- nitpick:finding:([0-9a-f]+) -->/.exec(body)?.[1] ?? null;

/**
 * Model text is built from untrusted PR content, so a hostile diff could steer
 * it. Strip what acts on GitHub beyond the comment itself: mentions notify
 * people, `#123` and `owner/repo#1` link and backlink, HTML comments could
 * forge our markers.
 */
export const sanitize = (text: string): string =>
  text
    .replace(/<!--[\s\S]*?(-->|$)/g, "")
    .replace(/(^|[^\w`/])@([a-zA-Z0-9][\w-]*(?:\/[\w-]+)?)/g, "$1`@$2`")
    .replace(/\b(fix(?:e[sd])?|close[sd]?|resolve[sd]?)(\s+)(?=[\w./-]*#\d)/gi, "$1:$2")
    .trim();

const badge: Readonly<Record<Severity, string>> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

/** A fence longer than any backtick run inside `code`, so a suggestion cannot break out of it. */
const fenceFor = (code: string): string => {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((match) => match[0].length));

  return "`".repeat(longest + 1);
};

export const renderFinding = (finding: PlacedFinding): string => {
  const parts = [
    `**${badge[finding.severity]} · ${finding.category}: ${sanitize(finding.title)}**`,
    sanitize(finding.body),
  ];

  if (finding.suggestion !== undefined) {
    const fence = fenceFor(finding.suggestion);
    parts.push(`${fence}suggestion\n${finding.suggestion}\n${fence}`);
  }

  parts.push(findingMarker(finding.fingerprint));

  return parts.join("\n\n");
};

export interface SummaryInput {
  readonly summary: string;
  readonly confidence: number;
  readonly diagram: string | undefined;
  readonly findings: ReadonlyArray<PlacedFinding>;
  /** Findings GitHub refused to place inline. They are listed in the comment instead. */
  readonly unplaced: ReadonlyArray<PlacedFinding>;
  readonly reviewUrl: string;
}

export const clampConfidence = (value: number): number =>
  Math.min(5, Math.max(1, Math.round(value)));

export const renderSummary = (input: SummaryInput): string => {
  const confidence = clampConfidence(input.confidence);

  const counts = (["critical", "major", "minor"] as const).flatMap((severity) => {
    const count = input.findings.filter((finding) => finding.severity === severity).length;

    return count > 0 ? [`${count} ${severity}`] : [];
  });

  const parts = [
    summaryMarker,
    "## Nitpick review",
    sanitize(input.summary),
    `**Confidence to merge: ${confidence}/5** · ${counts.length > 0 ? counts.join(", ") : "no issues found"}`,
  ];

  if (input.diagram !== undefined && input.diagram.trim() !== "") {
    const diagram = input.diagram.replace(/^```(?:mermaid)?\s*|\s*```$/g, "").replaceAll("```", "");
    parts.push(
      `<details><summary>Sequence diagram</summary>\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\n</details>`,
    );
  }

  if (input.unplaced.length > 0) {
    const rows = input.unplaced.map(
      (finding) =>
        `- \`${finding.path}:${finding.line}\` ${sanitize(finding.title)}: ${sanitize(finding.body)}`,
    );

    parts.push(`### Findings outside the diff view\n\n${rows.join("\n")}`);
  }

  parts.push(`[Open in Nitpick](${input.reviewUrl})`);

  return parts.join("\n\n");
};

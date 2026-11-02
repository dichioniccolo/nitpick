import type { Impact, Severity } from "@nitpick/review-domain";

import type { PlacedFinding } from "./Findings.ts";

export const summaryMarker = "<!-- nitpick:summary -->";

export const findingMarker = (fingerprint: string): string =>
  `<!-- nitpick:finding:${fingerprint} -->`;

/** The last marker wins: ours closes the body, so one quoted in a suggestion comes first. */
export const fingerprintFromBody = (body: string): string | null =>
  [...body.matchAll(/<!-- nitpick:finding:([0-9a-f]+) -->/g)].at(-1)?.[1] ?? null;

const zeroWidthSpace = "​";

const stripNul = (text: string): string => text.replaceAll("\0", "");

/**
 * Drop comments, reaching a fixed point in one pass. Removal happens against
 * the output, so `<<!-- x -->!-- y -->` cannot reassemble a comment. An
 * unterminated comment runs to the end of the text.
 */
const stripComments = (text: string): string => {
  const output: Array<string> = [];
  let index = 0;

  while (index < text.length) {
    const char = text.charAt(index);

    if (output.at(-1) !== "<" || char !== "!" || !text.startsWith("--", index + 1)) {
      output.push(char);
      index += 1;
      continue;
    }

    output.pop();

    const end = text.indexOf("-->", index + 1);

    if (end === -1) break;
    index = end + 3;
  }

  return output.join("");
};

/** A link kept as it is: plain `https://` to GitHub, with nothing a parser could decode into more. */
const liveLink = /\]\((?!https:\/\/(?:[a-z0-9-]+\.)*github\.com\/[^\s()<>&\\"']*\))/gi;

/**
 * Model text is built from untrusted PR content, so a hostile diff could steer
 * it. Comments go, since they could forge our markers. Everything else stays
 * readable and is broken with a zero-width space, which needs no Markdown
 * parser and so gives escapes and entities nothing to fool:
 *
 * - `<` before a tag, so HTML stays text and `Array<string>` survives.
 * - `![`, `](` unless it is a plain GitHub link, and `]:`, so nothing fetches
 *   through Camo with private code in the URL and no link leaves GitHub.
 * - `@name`, addresses, `#123`, `owner/repo#123` and `GH-123`, which notify and backlink.
 * - `://` off GitHub and `www.`, so a bare URL does not autolink.
 *
 * Code spans get the same treatment, because hostile text can close them. Each
 * step is linear, and running it twice changes nothing.
 */
export const sanitize = (text: string): string =>
  stripComments(stripNul(text))
    .replaceAll("&commat;", "@")
    .replaceAll("&num;", "#")
    .trim()
    .replace(/<(?=[a-zA-Z/!?]|$)/g, `$&${zeroWidthSpace}`)
    .replace(/!(?=\[)/g, `$&${zeroWidthSpace}`)
    .replace(/:(?=\/\/(?!(?:[a-z0-9-]+\.)*github\.com\/))/gi, `$&${zeroWidthSpace}`)
    // Before the dot: a URL parser drops U+200B, so `www.\u200bevil.example` would still link.
    .replace(/www(?=\.)/gi, `$&${zeroWidthSpace}`)
    .replace(liveLink, `]${zeroWidthSpace}(`)
    .replace(/\](?=:)/g, `$&${zeroWidthSpace}`)
    .replace(/@(?=[a-zA-Z0-9])/g, `$&${zeroWidthSpace}`)
    .replace(/#(?=\d)|(?<=&)#(?!\u200b)/g, `$&${zeroWidthSpace}`)
    .replace(/\bGH-(?=\d)/gi, `$&${zeroWidthSpace}`);

const badge: Readonly<Record<Severity, string>> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

const longestBacktickRun = (code: string): number => {
  let longest = 0;

  for (const match of code.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);

  return longest;
};

/** A fence longer than any backtick run inside `code`, so its content cannot break out of it. */
const fenceFor = (code: string): string => "`".repeat(Math.max(2, longestBacktickRun(code)) + 1);

/** A code span no backtick in `text` can close. A file path may hold backticks or newlines. */
const inlineCode = (text: string): string => {
  const code = stripNul(text).replace(/[\r\n]+/g, " ");
  const delimiter = "`".repeat(longestBacktickRun(code) + 1);
  const padding = code.startsWith("`") || code.endsWith("`") ? " " : "";

  return `${delimiter}${padding}${code}${padding}${delimiter}`;
};

/** The model often wraps its diagram in a fence of its own; ours replaces that one. */
const unwrapFence = (diagram: string): string => {
  const trimmed = diagram.trim();
  const open = /^```(?:mermaid)?[ \t]*\n/.exec(trimmed);

  return open !== null && trimmed.endsWith("\n```")
    ? trimmed.slice(open[0].length, -"\n```".length)
    : diagram;
};

export const renderFinding = (finding: PlacedFinding): string => {
  const parts = [
    `**${badge[finding.severity]} · ${finding.category}: ${sanitize(finding.title)}**`,
    sanitize(finding.body),
  ];

  if (finding.suggestion !== undefined) {
    const suggestion = stripNul(finding.suggestion);
    const fence = fenceFor(suggestion);
    parts.push(`${fence}suggestion\n${suggestion}\n${fence}`);
  }

  parts.push(findingMarker(finding.fingerprint));

  return parts.join("\n\n");
};

export interface SummaryInput {
  /** `null` on a review saved before the impact line existed. */
  readonly impact: Impact | null;
  readonly verdict: string | null;
  readonly summary: string;
  readonly changes: ReadonlyArray<string>;
  readonly confidence: number;
  readonly diagram: string | undefined;
  readonly findings: ReadonlyArray<PlacedFinding>;
  /** Findings GitHub refused to place inline. They are listed in the comment instead. */
  readonly unplaced: ReadonlyArray<PlacedFinding>;
  readonly reviewUrl: string;
  readonly retriggerUrl: string;
  /** Where the button images are served, `<APP_URL>/badges`. */
  readonly badgesUrl: string;
  /** Completed reviews on this PR, this one included. */
  readonly reviewCount: number;
  readonly commit: { readonly sha: string; readonly url: string };
}

export const clampConfidence = (value: number): number =>
  Math.min(5, Math.max(1, Math.round(value)));

const impactLabel: Readonly<Record<Impact, string>> = {
  low: "Low impact",
  medium: "Medium impact",
  high: "High impact",
};

/** A link wrapping a right-floated image, so the buttons sit on the heading's line as GitHub renders it. */
const button = (href: string, src: string, alt: string): string =>
  `<a href="${href}"><img align="right" height="28" alt="${alt}" src="${src}"></a>`;

/** One bullet per line: a newline in model text would start a new block. */
const bullet = (text: string): string => `- ${sanitize(text).replace(/\s*[\r\n]+\s*/g, " ")}`;

/** `["1 critical", "2 minor"]`, worst first, leaving out severities with no finding. */
export const severityCounts = (
  findings: ReadonlyArray<{ readonly severity: Severity }>,
): ReadonlyArray<string> =>
  (["critical", "major", "minor"] as const).flatMap((severity) => {
    const count = findings.filter((finding) => finding.severity === severity).length;

    return count > 0 ? [`${count} ${severity}`] : [];
  });

export const renderSummary = (input: SummaryInput): string => {
  const counts = severityCounts(input.findings);

  const parts = [
    summaryMarker,
    // Floats stack right to left, so Retrigger ends up rightmost, as on Greptile.
    `${button(input.retriggerUrl, `${input.badgesUrl}/retrigger.svg`, "Retrigger")}${button(input.reviewUrl, `${input.badgesUrl}/view.svg`, "View in Nitpick")}`,
    `## Confidence Score: ${clampConfidence(input.confidence)}/5`,
  ];

  if (input.impact !== null && input.verdict !== null && input.verdict.trim() !== "")
    parts.push(`**[${impactLabel[input.impact]}]** ${sanitize(input.verdict)}`);

  parts.push("### Summary", sanitize(input.summary));

  if (input.changes.length > 0) parts.push(input.changes.map(bullet).join("\n"));

  parts.push(`**Findings:** ${counts.length > 0 ? counts.join(", ") : "no issues found"}`);

  if (input.diagram !== undefined && input.diagram.trim() !== "") {
    const diagram = unwrapFence(stripNul(input.diagram));
    const fence = fenceFor(diagram);
    parts.push(`### Diagram\n\n${fence}mermaid\n${diagram}\n${fence}`);
  }

  if (input.unplaced.length > 0) {
    const rows = input.unplaced.map(
      (finding) =>
        `- ${inlineCode(`${finding.path}:${finding.line}`)} ${sanitize(finding.title)}: ${sanitize(finding.body)}`,
    );

    parts.push(`### Findings outside the diff view\n\n${rows.join("\n")}`);
  }

  parts.push(
    `<sub>Reviews (${input.reviewCount}) · Last reviewed commit: <a href="${input.commit.url}">${input.commit.sha.slice(0, 7)}</a> · <a href="${input.reviewUrl}">Reviewed by Nitpick</a></sub>`,
  );

  return parts.join("\n\n");
};

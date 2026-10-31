import type { Severity } from "@nitpick/review-domain";

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

/** Where the `(...)` opening at `open` ends: past its `)`, or at a blank line or the text's end. */
const destinationEnd = (text: string, open: number): number => {
  let depth = 0;
  let index = open;

  while (index < text.length) {
    const char = text.charAt(index);

    if (char === "\\") {
      index += 2;
      continue;
    }

    if (char === "(") depth += 1;

    if (char === ")") depth -= 1;

    if (depth === 0) return index + 1;

    if (char === "\n" && text.charAt(index + 1) === "\n") return index;
    index += 1;
  }

  return text.length;
};

/** No scheme and no host: GitHub resolves it inside the repository, so it reaches nobody else. */
const isRelativeUrl = (destination: string): boolean =>
  !/^\s*(?:[a-z][a-z0-9+.-]*:|\/\/|\\)/i.test(destination);

const isGitHubUrl = (destination: string): boolean => {
  const host = /^https?:\/\/([a-z0-9.-]+)(?:[/?#]|$)/i.exec(destination)?.[1]?.toLowerCase();

  return host === "github.com" || host?.endsWith(".github.com") === true;
};

/**
 * Reduce images to alt text and links to their label, keeping a link only when
 * it points at GitHub. A bracket stack resolves nesting in one pass. `](` with
 * no opening bracket and a destination with no `)` go too, because another
 * field rendered beside this one could complete them.
 */
const reduceLinks = (text: string): string => {
  const output: Array<string> = [];
  const opens: Array<number> = [];
  let matched = -1;
  let index = 0;

  while (index < text.length) {
    const char = text.charAt(index);

    if (char === "[") opens.push(output.length);

    if (char === "]") matched = opens.pop() ?? -1;

    if (char !== "(" || output.at(-1) !== "]") {
      output.push(char);
      index += 1;
      continue;
    }

    const end = destinationEnd(text, index);
    const isImage = matched > 0 && output[matched - 1] === "!";

    const destination = text.slice(index + 1, end - 1);

    if (!isImage && (isRelativeUrl(destination) || isGitHubUrl(destination))) {
      output.push(text.slice(index, end));
    } else {
      output.pop();

      if (matched >= 0) output[matched] = "";

      if (isImage) output[matched - 1] = "";

      while (output.at(-1) === "") output.pop();
    }

    matched = -1;
    index = end;
  }

  return output.join("");
};

/** A reference definition, also inside a quote or list item. Labels hold no bare brackets. */
const linkDefinition = /^[ \t>*+\-0-9.)]*\[(?:[^[\]\\]|\\[\s\S])*\]:.*$/gm;

/**
 * Model text is built from untrusted PR content, so a hostile diff could steer
 * it. Remove what acts beyond the comment: HTML forges markers, images fetch
 * through Camo and carry private code in the URL, links lead off GitHub. Then
 * break what GitHub resolves in text with a zero-width space: mentions notify
 * people, `#123`, `owner/repo#123` and `GH-123` link and backlink, closing
 * keywords need a `#`. Code spans get the same treatment because hostile text
 * can close them. Every step is linear, and running it twice changes nothing.
 */
export const sanitize = (text: string): string =>
  reduceLinks(stripComments(stripNul(text).replaceAll("&commat;", "@").replaceAll("&num;", "#")))
    .replace(linkDefinition, "")
    // Breaks every tag and leaves the text readable, so `Array<string>` survives.
    .replace(/<(?=[a-zA-Z/!?]|$)/g, `$&${zeroWidthSpace}`)
    .replace(/(?<![a-zA-Z0-9])@(?=[a-zA-Z0-9])/g, `$&${zeroWidthSpace}`)
    .replace(/#(?=\d)|(?<=&)#/g, `$&${zeroWidthSpace}`)
    .replace(/\bGH-(?=\d)/gi, `$&${zeroWidthSpace}`)
    .trim();

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
    const diagram = unwrapFence(stripNul(input.diagram));
    const fence = fenceFor(diagram);
    parts.push(
      `<details><summary>Sequence diagram</summary>\n\n${fence}mermaid\n${diagram}\n${fence}\n\n</details>`,
    );
  }

  if (input.unplaced.length > 0) {
    const rows = input.unplaced.map(
      (finding) =>
        `- ${inlineCode(`${finding.path}:${finding.line}`)} ${sanitize(finding.title)}: ${sanitize(finding.body)}`,
    );

    parts.push(`### Findings outside the diff view\n\n${rows.join("\n")}`);
  }

  parts.push(`[Open in Nitpick](${input.reviewUrl})`);

  return parts.join("\n\n");
};

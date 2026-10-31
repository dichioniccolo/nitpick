import { type ResolvedConfig, TrustedAssociations } from "@nitpick/review-domain";

export interface PullSnapshot {
  readonly draft: boolean;
  readonly author: string;
  readonly authorIsBot: boolean;
  readonly authorAssociation: string;
  readonly labels: ReadonlyArray<string>;
  readonly baseBranch: string;
  readonly defaultBranch: string;
}

/** Why a PR is not reviewed automatically, `null` when it is. An explicit request skips this check. */
export const skipReason = (pull: PullSnapshot, config: ResolvedConfig): string | null => {
  if (pull.authorIsBot) return "bot author";

  if (!TrustedAssociations.has(pull.authorAssociation)) return "author is not a repository member";

  if (config.skipDrafts && pull.draft) return "draft";

  if (config.ignoreAuthors.includes(pull.author)) return "ignored author";
  const label = pull.labels.find((name) => config.skipLabels.includes(name));

  if (label !== undefined) return `label ${label}`;
  const bases = config.baseBranches.length > 0 ? config.baseBranches : [pull.defaultBranch];

  return bases.includes(pull.baseBranch) ? null : `base branch ${pull.baseBranch}`;
};

/** The instruction after `@<slug>` in a comment, `null` when the App is not mentioned. */
export const mentionOf = (slug: string, body: string): string | null => {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)@${escaped}(?![\\w-])(?:\\[bot\\])?(.*)`, "is").exec(body);

  return match === null ? null : (match[1] ?? "").trim();
};

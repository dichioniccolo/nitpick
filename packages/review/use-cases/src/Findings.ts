import { createHash } from "node:crypto";
import * as Match from "effect/Match";
import type {
  FindingDraft,
  FindingVerdict,
  ResolvedConfig,
  Severity,
  Strictness,
} from "@nitpick/review-domain";

import { commentableLines, isIgnored, type PullFile } from "./Diff.ts";

/** A finding ready to post. `scenario` and `evidence` are null on rows saved before they existed. */
export interface PlacedFinding extends Omit<FindingDraft, "scenario" | "evidence" | "confidence"> {
  readonly scenario: string | null;
  readonly evidence: string | null;
  readonly fingerprint: string;
}

/** Worst first: a lower rank is more severe. */
export const severityRank: Readonly<Record<Severity, number>> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** The least severe finding each strictness posts. */
const floor: Readonly<Record<Strictness, Severity>> = {
  strict: "P3",
  balanced: "P2",
  relaxed: "P1",
};

/** Same path, category and title reads as the same finding when line numbers shift between pushes. */
export const fingerprintOf = (finding: Pick<FindingDraft, "path" | "category" | "title">): string =>
  createHash("sha256")
    .update(
      `${finding.path}\0${finding.category}\0${finding.title.toLowerCase().replace(/\W+/g, " ").trim()}`,
    )
    .digest("hex")
    .slice(0, 16);

/** A finding raised on an earlier head that this head still has. It counts, but is not posted again. */
export interface RepeatedFinding {
  readonly fingerprint: string;
  readonly severity: Severity;
}

export interface SelectedFindings {
  readonly posted: ReadonlyArray<PlacedFinding>;
  readonly repeated: ReadonlyArray<RepeatedFinding>;
}

/**
 * Keep the findings GitHub can place and the team wants: on a diff line, in a
 * path that is not ignored, above the strictness floor. Rule breaches pass the
 * floor, since a team wrote the rule. A finding raised before on this PR goes to
 * `repeated` instead of `posted`. `posted` is worst first, capped at `maxFindings`.
 */
export const selectFindings = (
  drafts: ReadonlyArray<FindingDraft>,
  files: ReadonlyArray<PullFile>,
  config: ResolvedConfig,
  known: ReadonlySet<string>,
): SelectedFindings => {
  const lines = new Map(files.map((file) => [file.path, commentableLines(file.patch ?? "")]));
  const seen = new Set<string>();
  const kept: Array<PlacedFinding> = [];
  const repeated: Array<RepeatedFinding> = [];

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

    if (known.has(fingerprint)) {
      repeated.push({ fingerprint, severity: draft.severity });
      continue;
    }

    // A multi-line comment needs both ends in one hunk; a start GitHub would reject is dropped.
    const { startLine, confidence: _confidence, ...rest } = draft;
    const validStart = startLine !== undefined && startLine < draft.line && onDiff.has(startLine);
    kept.push({ ...rest, startLine: validStart ? startLine : undefined, fingerprint });
  }

  const posted = kept
    .toSorted((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, config.maxFindings);

  return { posted, repeated };
};

/**
 * More thumbs down than up from people who can push (see `syncFeedback`). A dismissed finding
 * never counts again, so a team can clear one the model keeps raising.
 */
export const isDismissed = (votes: {
  readonly reactionsUp: number;
  readonly reactionsDown: number;
}): boolean => votes.reactionsDown > votes.reactionsUp;

/**
 * The findings this head still has: the ones it posted, plus repeats of earlier ones it has not
 * posted itself. The confidence score and the check both judge this set.
 */
export const openFindings = (
  posted: ReadonlyArray<{ readonly fingerprint: string; readonly severity: Severity }>,
  repeated: ReadonlyArray<RepeatedFinding>,
): ReadonlyArray<{ readonly severity: Severity }> => {
  const own = new Set(posted.map((item) => item.fingerprint));

  return [...posted, ...repeated.filter((item) => !own.has(item.fingerprint))];
};

/**
 * The confidence score of a head's open findings (see `openFindings`): 5 with none, 4 with P2 or P3
 * only, 3 with one P1, 2 with several, 1 with any P0. Findings the strictness floor or the noise
 * list dropped never lower it, so a head with nothing open reads 5/5.
 */
export const confidenceOf = (findings: ReadonlyArray<{ readonly severity: Severity }>): number => {
  const count = (severity: Severity) =>
    findings.filter((finding) => finding.severity === severity).length;

  return Match.value({
    p0: count("P0"),
    p1: count("P1"),
    lower: count("P2") + count("P3"),
  }).pipe(
    Match.when({ p0: (n) => n > 0 }, () => 1),
    Match.when({ p1: (n) => n > 1 }, () => 2),
    Match.when({ p1: 1 }, () => 3),
    Match.when({ lower: (n) => n > 0 }, () => 4),
    Match.orElse(() => 5),
  );
};

/**
 * The specialists' findings as one candidate list. Two with one fingerprint are the same finding;
 * the more severe one stays, and the first reported wins a tie.
 */
export const mergeCandidates = (
  lists: ReadonlyArray<ReadonlyArray<FindingDraft>>,
): ReadonlyArray<FindingDraft> => {
  const byFingerprint = new Map<string, FindingDraft>();

  for (const draft of lists.flat()) {
    const fingerprint = fingerprintOf(draft);
    const held = byFingerprint.get(fingerprint);

    if (held === undefined || severityRank[draft.severity] < severityRank[held.severity])
      byFingerprint.set(fingerprint, draft);
  }

  return [...byFingerprint.values()];
};

export interface VerifiedFindings {
  readonly confirmed: ReadonlyArray<FindingDraft>;
  readonly rejected: number;
}

/**
 * Keep the candidates the verifier confirmed, by their index. A candidate with no verdict counts as
 * rejected, so nothing unverified is posted. A severity it gives only applies when it is lower. When
 * the verifier names one id twice, the first verdict counts.
 */
export const applyVerdicts = (
  candidates: ReadonlyArray<FindingDraft>,
  verdicts: ReadonlyArray<FindingVerdict>,
): VerifiedFindings => {
  const byId = new Map<number, FindingVerdict>();

  for (const verdict of verdicts) if (!byId.has(verdict.id)) byId.set(verdict.id, verdict);

  const confirmed = candidates.flatMap((candidate, id) => {
    const verdict = byId.get(id);

    if (verdict === undefined || verdict.decision !== "confirmed") return [];
    const lowered = verdict.severity;

    return [
      lowered !== undefined && severityRank[lowered] > severityRank[candidate.severity]
        ? { ...candidate, severity: lowered }
        : candidate,
    ];
  });

  return { confirmed, rejected: candidates.length - confirmed.length };
};

import type { Claude, ClaudeError } from "@nitpick/anthropic";
import {
  Category,
  FindingConfidence,
  FindingsDraft,
  type FindingDraft,
  Impact,
  Severity,
  Specialist,
  VerdictDecision,
  VerifiedReview,
} from "@nitpick/review-domain";
import {
  applyVerdicts,
  mergeCandidates,
  type ReviewContext,
  reviewPrompt,
  specialistSystem,
  verifierPrompt,
  verifierSystem,
} from "@nitpick/review-use-cases";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";

import { type AgentError, type AgentTool, decoder, objectSchema, runAgent } from "./Agent.ts";

const severity = {
  type: "string",
  enum: [...Severity.literals],
  description: "P0 catastrophic, P1 major, P2 one workflow, P3 minor.",
};

const findingItem = {
  type: "object",
  properties: {
    path: { type: "string" },
    startLine: { type: "integer" },
    line: { type: "integer", description: "New-file line from the diff gutter." },
    severity,
    category: { type: "string", enum: [...Category.literals] },
    title: { type: "string", description: "Under 80 characters." },
    body: { type: "string", description: "What goes wrong and why, for the author." },
    scenario: { type: "string", description: "The input, state or sequence that triggers it." },
    evidence: {
      type: "string",
      description: "path:line references and what each shows, proving the defect.",
    },
    confidence: { type: "string", enum: [...FindingConfidence.literals] },
    suggestion: {
      type: "string",
      description: "Replacement text for startLine through line.",
    },
  },
  required: [
    "path",
    "line",
    "severity",
    "category",
    "title",
    "body",
    "scenario",
    "evidence",
    "confidence",
  ],
  additionalProperties: false,
};

const submitFindings = {
  definition: {
    name: "submit_findings",
    description: "Submit your findings. Ends your run. An empty list is a valid answer.",
    eager_input_streaming: true,
    input_schema: objectSchema({ findings: { type: "array", items: findingItem } }, ["findings"]),
  },
  decode: decoder(FindingsDraft),
};

const submitReview = {
  definition: {
    name: "submit_review",
    description: "Submit the verdicts and the review summary. Ends the run.",
    eager_input_streaming: true,
    input_schema: objectSchema(
      {
        impact: {
          type: "string",
          enum: [...Impact.literals],
          description: "How much this change matters to the system, whatever its quality.",
        },
        verdict: {
          type: "string",
          description: "One sentence: your call on merging and the reason. Plain text.",
        },
        summary: {
          type: "string",
          description: "One or two sentences on what the PR does, in Markdown.",
        },
        changes: {
          type: "array",
          items: { type: "string" },
          description:
            "Three to eight bullets, one notable change each, one line, no leading dash.",
        },
        diagram: {
          type: "string",
          description: "Optional Mermaid sequenceDiagram source, without a code fence.",
        },
        verdicts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer", description: "The candidate number." },
              decision: { type: "string", enum: [...VerdictDecision.literals] },
              reason: { type: "string", description: "One sentence, citing the code you read." },
              severity: { ...severity, description: "Only to lower the candidate's severity." },
            },
            required: ["id", "decision", "reason"],
            additionalProperties: false,
          },
        },
      },
      ["impact", "verdict", "summary", "changes", "verdicts"],
    ),
  },
  decode: decoder(VerifiedReview),
};

/** Each specialist's turn budget. The verifier gets more, as it reads every candidate's path. */
const specialistTurns = 20;
const verifierTurns = 30;

/**
 * Wall time per run. The specialists run side by side, then the verifier, so a review takes at
 * most both together: 24 minutes, inside the worker's 30 minute job timeout.
 */
const specialistTimeout = Duration.minutes(12);
const verifierTimeout = Duration.minutes(12);

export interface PanelResult {
  readonly impact: Impact;
  readonly verdict: string;
  readonly summary: string;
  readonly changes: ReadonlyArray<string>;
  readonly diagram: string | undefined;
  /** What the verifier confirmed, before `selectFindings` places it. */
  readonly findings: ReadonlyArray<FindingDraft>;
  readonly candidates: number;
  readonly rejected: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Random per run. The verifier's differs from the specialists', which their output could repeat. */
export interface PanelNonces {
  readonly specialists: string;
  readonly verifier: string;
}

/**
 * The failure to raise when every specialist failed: a retryable Claude error first, so the job
 * retries when any run could succeed on another attempt, then any Claude error, then the rest.
 */
const worstFailure = (
  failures: ReadonlyArray<AgentError | ClaudeError>,
): AgentError | ClaudeError | undefined => {
  const claude = failures.filter((error): error is ClaudeError =>
    Predicate.isTagged(error, "ClaudeError"),
  );

  return claude.find((error) => error.retryable) ?? claude[0] ?? failures[0];
};

/** What a log line may say about a failed run: tags, reasons and statuses, never content. */
const failureFields = Match.type<AgentError | ClaudeError>().pipe(
  Match.tag("AgentError", (error) => ({ tag: error._tag, reason: error.reason })),
  Match.tag("ClaudeError", (error) => ({
    tag: error._tag,
    status: error.status,
    retryable: error.retryable,
  })),
  Match.exhaustive,
);

/**
 * The review panel. The specialists run in parallel, each with its own focus; their findings
 * merge by fingerprint, then one verifier checks every candidate and writes the summary. A
 * specialist that fails is logged and left out, unless all fail. A verifier failure fails the
 * review, so no unverified finding is ever posted.
 */
export const runPanel = Effect.fn("review.panel.run")(function* (
  context: ReviewContext,
  tools: ReadonlyArray<AgentTool>,
  nonces: PanelNonces,
): Effect.fn.Return<PanelResult, AgentError | ClaudeError, Claude> {
  const prompt = reviewPrompt(context, nonces.specialists);

  const runs = yield* Effect.forEach(
    Specialist.literals,
    (specialist) =>
      runAgent({
        system: specialistSystem[specialist],
        prompt,
        tools,
        finish: submitFindings,
        maxTurns: specialistTurns,
        timeout: specialistTimeout,
      }).pipe(
        Effect.withSpan("review.specialist.run", { attributes: { specialist } }),
        Effect.tapError((error) =>
          Effect.logWarning("specialist failed").pipe(
            Effect.annotateLogs({ specialist, ...failureFields(error) }),
          ),
        ),
        Effect.result,
      ),
    { concurrency: Specialist.literals.length },
  );

  const succeeded = runs.flatMap((run) => (Result.isSuccess(run) ? [run.success] : []));
  const failures = runs.flatMap((run) => (Result.isFailure(run) ? [run.failure] : []));
  const failed = worstFailure(failures);

  if (succeeded.length === 0 && failed !== undefined) return yield* Effect.fail(failed);

  const candidates = mergeCandidates(succeeded.map((run) => run.value.findings));

  const verified = yield* runAgent({
    system: verifierSystem,
    prompt: verifierPrompt(context, candidates, nonces.verifier),
    tools,
    finish: submitReview,
    maxTurns: verifierTurns,
    timeout: verifierTimeout,
  }).pipe(Effect.withSpan("review.verifier.run"));

  const { confirmed, rejected } = applyVerdicts(candidates, verified.value.verdicts);

  yield* Effect.logInfo("review verified").pipe(
    Effect.annotateLogs({
      specialists: succeeded.length,
      candidates: candidates.length,
      confirmed: confirmed.length,
      rejected,
    }),
  );

  // A specialist that failed with an AgentError still spent its tokens; a Claude error's are unknown.
  const spent = [
    ...succeeded,
    ...failures.filter((error): error is AgentError => Predicate.isTagged(error, "AgentError")),
  ];

  const sum = (key: "inputTokens" | "outputTokens") =>
    spent.reduce((total, run) => total + run[key], verified[key]);

  return {
    impact: verified.value.impact,
    verdict: verified.value.verdict,
    summary: verified.value.summary,
    changes: verified.value.changes,
    diagram: verified.value.diagram,
    findings: confirmed,
    candidates: candidates.length,
    rejected,
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
  };
});

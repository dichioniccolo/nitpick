import type { Claude, ClaudeError } from "@nitpick/anthropic";
import {
  FindingsDraft,
  type FindingDraft,
  type Impact,
  Specialist,
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
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { type AgentError, type AgentTool, decoder, objectSchema, runAgent } from "./Agent.ts";

const severity = {
  type: "string",
  enum: ["P0", "P1", "P2", "P3"],
  description: "P0 catastrophic, P1 major, P2 one workflow, P3 minor.",
} as const;

const findingItem = {
  type: "object",
  properties: {
    path: { type: "string" },
    startLine: { type: "integer" },
    line: { type: "integer", description: "New-file line from the diff gutter." },
    severity,
    category: {
      type: "string",
      enum: ["logic", "security", "performance", "reliability", "style", "testing", "rule"],
    },
    title: { type: "string", description: "Under 80 characters." },
    body: { type: "string", description: "What goes wrong and why, for the author." },
    scenario: { type: "string", description: "The input, state or sequence that triggers it." },
    evidence: {
      type: "string",
      description: "path:line references and what each shows, proving the defect.",
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
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
} as const;

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
          enum: ["low", "medium", "high"],
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
              decision: { type: "string", enum: ["confirmed", "rejected"] },
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

/**
 * The review panel. The specialists run in parallel, each with its own focus; their findings
 * merge by fingerprint, then one verifier checks every candidate and writes the summary. A
 * specialist that fails is logged and left out, unless all fail. A verifier failure fails the
 * review, so no unverified finding is ever posted.
 */
export const runPanel = Effect.fn("review.panel.run")(function* (
  context: ReviewContext,
  tools: ReadonlyArray<AgentTool>,
  nonce: string,
): Effect.fn.Return<PanelResult, AgentError | ClaudeError, Claude> {
  const prompt = reviewPrompt(context, nonce);

  const runs = yield* Effect.forEach(
    Specialist.literals,
    (specialist) =>
      runAgent({
        system: specialistSystem[specialist],
        prompt,
        tools,
        finish: submitFindings,
        maxTurns: specialistTurns,
      }).pipe(
        Effect.withSpan("review.specialist", { attributes: { specialist } }),
        Effect.tapError((error) => Effect.logWarning("specialist failed", specialist, error._tag)),
        Effect.result,
      ),
    { concurrency: Specialist.literals.length },
  );

  const succeeded = runs.flatMap((run) => (Result.isSuccess(run) ? [run.success] : []));
  const firstFailure = runs.find(Result.isFailure);

  if (succeeded.length === 0 && firstFailure !== undefined) return yield* firstFailure.failure;

  const candidates = mergeCandidates(succeeded.map((run) => run.value.findings));

  const verified = yield* runAgent({
    system: verifierSystem,
    prompt: verifierPrompt(context, candidates, nonce),
    tools,
    finish: submitReview,
    maxTurns: verifierTurns,
  }).pipe(Effect.withSpan("review.verifier"));

  const { confirmed, rejected } = applyVerdicts(candidates, verified.value.verdicts);

  yield* Effect.logInfo("review verified").pipe(
    Effect.annotateLogs({
      specialists: succeeded.length,
      candidates: candidates.length,
      confirmed: confirmed.length,
      rejected,
    }),
  );

  const sum = (key: "inputTokens" | "outputTokens") =>
    succeeded.reduce((total, run) => total + run[key], verified[key]);

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

import { Claude, type ClaudeError } from "@nitpick/anthropic";
import { repository } from "@nitpick/code-graph-tables";
import {
  GitHub,
  type GitHubError,
  type PullRequest,
  type RepoRef,
  toRepoRef,
} from "@nitpick/github";
import { Database } from "@nitpick/postgres";
import {
  RepoConfig,
  ReviewDraft,
  type ResolvedConfig,
  resolveConfig,
  ResolvedConfig as defaults,
} from "@nitpick/review-domain";
import { finding, learning, review, rule } from "@nitpick/review-tables";
import {
  clampConfidence,
  fingerprintFromBody,
  type PlacedFinding,
  renderFinding,
  renderSummary,
  reviewPrompt,
  reviewSystem,
  sanitize,
  selectFindings,
  skipReason,
} from "@nitpick/review-use-cases";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

import { type AgentError, decoder, objectSchema, runAgent } from "./Agent.ts";
import { Settings } from "./Settings.ts";
import { toolsFor } from "./Tools.ts";

const decodeJson = S.decodeUnknownEffect(S.fromJsonString(RepoConfig));

/** Read at the base commit, so a PR cannot weaken the rules that review it. */
export const loadConfig = Effect.fn("review.config.load")(function* (
  ref: RepoRef,
  baseSha: string,
) {
  const github = yield* GitHub;
  const raw = yield* github.fileText(ref, ".nitpick.json", baseSha);

  if (raw === null) return defaults;

  return yield* decodeJson(raw).pipe(
    Effect.map(resolveConfig),
    Effect.tapError((issue) => Effect.logWarning("invalid .nitpick.json", String(issue))),
    Effect.orElseSucceed((): ResolvedConfig => defaults),
  );
});

const finishTool = {
  definition: {
    name: "submit_review",
    description: "Submit the finished review. Ends the run.",
    eager_input_streaming: true,
    input_schema: objectSchema(
      {
        summary: {
          type: "string",
          description: "What the PR does and your verdict, in Markdown, under 200 words.",
        },
        confidence: { type: "integer", description: "1 to 5." },
        diagram: {
          type: "string",
          description: "Optional Mermaid sequenceDiagram source, without a code fence.",
        },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              startLine: { type: "integer" },
              line: { type: "integer", description: "New-file line from the diff gutter." },
              severity: { type: "string", enum: ["critical", "major", "minor"] },
              category: {
                type: "string",
                enum: ["logic", "security", "performance", "reliability", "style", "rule"],
              },
              title: { type: "string", description: "Under 80 characters." },
              body: { type: "string" },
              suggestion: {
                type: "string",
                description: "Replacement text for startLine through line.",
              },
            },
            required: ["path", "line", "severity", "category", "title", "body"],
            additionalProperties: false,
          },
        },
      },
      ["summary", "confidence", "findings"],
    ),
  },
  decode: decoder(ReviewDraft),
};

/** Post inline comments. A 422 means GitHub refused a line; those go in the summary instead. */
const publishInline = Effect.fnUntraced(function* (
  ref: RepoRef,
  pull: PullRequest,
  placed: ReadonlyArray<PlacedFinding>,
) {
  const github = yield* GitHub;

  if (placed.length === 0) return new Map<string, number>();

  const posted = yield* github
    .createReview(
      ref,
      pull.number,
      pull.headSha,
      placed.map((item) => ({
        path: item.path,
        line: item.line,
        startLine: item.startLine,
        body: renderFinding(item),
      })),
    )
    .pipe(
      Effect.catchIf(
        (error) => error.status === 422,
        (error) =>
          Effect.as(Effect.logWarning("GitHub refused inline comments", error.operation), []),
      ),
    );

  return new Map(
    posted.flatMap((comment) => {
      const fingerprint = fingerprintFromBody(comment.body);

      return fingerprint === null ? [] : [[fingerprint, comment.id] as const];
    }),
  );
});

export const reviewPullRequest = Effect.fn("review.pull.run")(function* (payload: {
  readonly repositoryId: number;
  readonly prNumber: number;
  readonly headSha: string;
  readonly trigger: "opened" | "pushed" | "requested";
}) {
  const db = yield* Database;
  const github = yield* GitHub;
  const settings = yield* Settings;
  const claude = yield* Claude;

  const [repo] = yield* db
    .select()
    .from(repository)
    .where(eq(repository.id, payload.repositoryId))
    .pipe(Effect.orDie);

  if (repo === undefined || !repo.enabled) return;

  const ref = toRepoRef(repo.installationId, repo.fullName);
  const pull = yield* github.pullRequest(ref, payload.prNumber);
  const requested = payload.trigger === "requested";

  if (pull.state !== "open") return;

  // A newer push queued its own job; this commit is no longer what people will merge.
  if (!requested && pull.headSha !== payload.headSha) return;

  const config = yield* loadConfig(ref, pull.baseSha);

  if (!requested) {
    const reason = skipReason(
      {
        draft: pull.draft,
        author: pull.author,
        authorIsBot: pull.authorIsBot,
        authorAssociation: pull.authorAssociation,
        labels: pull.labels,
        baseBranch: pull.baseBranch,
        defaultBranch: repo.defaultBranch,
      },
      config,
    );

    if (reason !== null || (payload.trigger === "pushed" && !config.triggerOnUpdates)) {
      yield* Effect.logInfo("review skipped", reason ?? "updates are off");

      return;
    }
  }

  const [existing] = yield* db
    .select({ id: review.id, status: review.status })
    .from(review)
    .where(
      and(
        eq(review.repositoryId, repo.id),
        eq(review.prNumber, pull.number),
        eq(review.headSha, pull.headSha),
      ),
    )
    .pipe(Effect.orDie);

  if (existing?.status === "completed" && !requested) return;

  const [row] = yield* db
    .insert(review)
    .values({
      repositoryId: repo.id,
      prNumber: pull.number,
      prTitle: pull.title,
      prAuthor: pull.author,
      headSha: pull.headSha,
      baseSha: pull.baseSha,
    })
    .onConflictDoUpdate({
      target: [review.repositoryId, review.prNumber, review.headSha],
      set: { status: "running", error: null, finishedAt: null },
    })
    .returning({ id: review.id })
    .pipe(Effect.orDie);

  if (row === undefined) return;
  const reviewId = row.id;

  const work = Effect.gen(function* () {
    const files = yield* github.pullFiles(ref, pull.number);

    const rules = yield* db
      .select({ text: rule.text })
      .from(rule)
      .where(and(eq(rule.repositoryId, repo.id), eq(rule.enabled, true)))
      .pipe(Effect.orDie);

    const learned = yield* db
      .select({ verdict: learning.verdict, text: learning.text })
      .from(learning)
      .where(eq(learning.repositoryId, repo.id))
      .orderBy(desc(learning.createdAt))
      .limit(50)
      .pipe(Effect.orDie);

    const previous = yield* db
      .select({ title: finding.title, path: finding.path, fingerprint: finding.fingerprint })
      .from(finding)
      .where(and(eq(finding.repositoryId, repo.id), eq(finding.prNumber, pull.number)))
      .pipe(Effect.orDie);

    const tools = yield* toolsFor(repo.id, ref, pull.headSha);

    const result = yield* runAgent({
      system: reviewSystem,
      prompt: reviewPrompt({
        title: pull.title,
        body: pull.body,
        author: pull.author,
        baseBranch: pull.baseBranch,
        files,
        config,
        rules: rules.map((item) => item.text),
        noise: learned.filter((item) => item.verdict === "noise").map((item) => item.text),
        useful: learned.filter((item) => item.verdict === "useful").map((item) => item.text),
        previousFindings: previous.map((item) => `${item.path}: ${item.title}`),
      }),
      tools,
      finish: finishTool,
      maxTurns: 30,
    });

    const placed = selectFindings(
      result.value.findings,
      files,
      config,
      new Set(previous.map((item) => item.fingerprint)),
    );

    const commentIds = yield* publishInline(ref, pull, placed);

    const [last] = yield* db
      .select({ commentId: review.summaryCommentId })
      .from(review)
      .where(
        and(
          eq(review.repositoryId, repo.id),
          eq(review.prNumber, pull.number),
          isNotNull(review.summaryCommentId),
        ),
      )
      .orderBy(desc(review.createdAt))
      .limit(1)
      .pipe(Effect.orDie);

    const summaryCommentId = yield* github.upsertComment(
      ref,
      pull.number,
      last?.commentId ?? null,
      renderSummary({
        summary: result.value.summary,
        confidence: result.value.confidence,
        diagram: config.diagram ? result.value.diagram : undefined,
        findings: placed,
        unplaced: placed.filter((item) => !commentIds.has(item.fingerprint)),
        reviewUrl: `${settings.appUrl}/app/reviews/${reviewId}`,
      }),
    );

    if (placed.length > 0) {
      yield* db
        .insert(finding)
        .values(
          placed.map((item) => ({
            reviewId,
            repositoryId: repo.id,
            prNumber: pull.number,
            path: item.path,
            startLine: item.startLine ?? null,
            line: item.line,
            severity: item.severity,
            category: item.category,
            title: sanitize(item.title),
            body: sanitize(item.body),
            suggestion: item.suggestion ?? null,
            fingerprint: item.fingerprint,
            githubCommentId: commentIds.get(item.fingerprint) ?? null,
          })),
        )
        .pipe(Effect.orDie);
    }

    yield* db
      .update(review)
      .set({
        status: "completed",
        summary: sanitize(result.value.summary),
        confidence: clampConfidence(result.value.confidence),
        diagram: config.diagram ? (result.value.diagram ?? null) : null,
        model: claude.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        summaryCommentId,
        finishedAt: sql`now()`,
      })
      .where(eq(review.id, reviewId))
      .pipe(Effect.orDie);
  });

  yield* work.pipe(
    Effect.tapError((error: AgentError | ClaudeError | GitHubError) =>
      db
        .update(review)
        .set({ status: "failed", error: error._tag, finishedAt: sql`now()` })
        .where(eq(review.id, reviewId))
        .pipe(Effect.orDie),
    ),
  );
});

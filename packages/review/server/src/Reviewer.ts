import { randomBytes } from "node:crypto";
import { Claude } from "@nitpick/anthropic";
import { installation, repository } from "@nitpick/code-graph-tables";
import {
  type CheckRunState,
  describeFailure,
  GitHub,
  type GitHubError,
  type PullRequest,
  type RepoRef,
  toRepoRef,
} from "@nitpick/github";
import { Database } from "@nitpick/postgres";
import {
  RepoConfig,
  type ResolvedConfig,
  resolveConfig,
  ResolvedConfig as defaults,
} from "@nitpick/review-domain";
import { finding, learning, review, rule } from "@nitpick/review-tables";
import {
  carriedCheckOutput,
  checkConclusion,
  checkName,
  completedCheckOutput,
  confidenceOf,
  failedCheckOutput,
  fingerprintFromBody,
  isDismissed,
  openFindings,
  type PlacedFinding,
  renderFinding,
  renderSummary,
  runningCheckOutput,
  sanitize,
  selectFindings,
  skippedCheckOutput,
  skipReason,
  summaryMarker,
} from "@nitpick/review-use-cases";
import { and, count, desc, eq, inArray, isNotNull, lt, ne, sql, or } from "drizzle-orm";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as O from "effect/Option";
import * as S from "effect/Schema";

import { runPanel } from "./Panel.ts";
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

/** How a past finding reads in the prompt: the parts its fingerprint is built from. */
const describeFinding = (item: {
  readonly path: string;
  readonly category: string;
  readonly title: string;
}): string => `${item.path} (${item.category}): ${item.title}`;

/** Post inline comments. A 422 means GitHub refused a line; those go in the summary instead. */
const publishInline = Effect.fnUntraced(function* (
  ref: RepoRef,
  pull: PullRequest,
  placed: ReadonlyArray<PlacedFinding>,
) {
  const github = yield* GitHub;

  if (placed.length === 0) return [];

  return yield* github
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
});

const byFingerprint = (comments: ReadonlyArray<{ readonly id: number; readonly body: string }>) =>
  new Map(
    comments.flatMap((comment) => {
      const fingerprint = fingerprintFromBody(comment.body);

      return fingerprint === null ? [] : [[fingerprint, comment.id] as const];
    }),
  );

type StoredFinding = typeof finding.$inferSelect;

const toPlaced = (item: StoredFinding): PlacedFinding => ({
  path: item.path,
  startLine: item.startLine ?? undefined,
  line: item.line,
  severity: item.severity,
  category: item.category,
  title: item.title,
  body: item.body,
  scenario: item.scenario,
  evidence: item.evidence,
  suggestion: item.suggestion ?? undefined,
  fingerprint: item.fingerprint,
});

/** A check write that hangs must not hold the review, nor the finalizer that ends a failed one. */
const checkWriteTimeout = Duration.seconds(15);

/** Check writes never fail a review: a missing Checks permission (403) or an outage only logs. */
const quietly = <A>(write: Effect.Effect<A, GitHubError>): Effect.Effect<A | null> =>
  write.pipe(
    Effect.timeoutOption(checkWriteTimeout),
    Effect.map(O.getOrNull),
    Effect.catchTag("GitHubError", (error) =>
      Effect.as(
        Effect.logWarning("check run write failed", error.operation, error.status ?? "no status"),
        null,
      ),
    ),
  );

/**
 * The check for a head nitpick does not review: `skipped` with `reason` when a
 * skip rule applies. Otherwise, for a push while updates are off or an opened
 * PR while `triggerOnOpen` is off, the stored conclusion of the last reviewed
 * head of this PR, or of this same commit on any PR in the repository, so no
 * push, reopen or new PR on a failed commit can turn its check into a pass.
 * With no reviewed head to carry it posts nothing: a required check then stays
 * pending until someone asks for a review, since `skipped` would pass it.
 */
const postUnreviewed = Effect.fnUntraced(function* (
  ref: RepoRef,
  repositoryId: number,
  pull: PullRequest,
  reason: string | null,
) {
  const db = yield* Database;
  const github = yield* GitHub;

  // The PR number lets Re-run find the PR where GitHub sends no `pull_requests`, as for a fork.
  const externalId = `${pull.number}`;

  const skipped = (why: string): CheckRunState => ({
    status: "completed",
    conclusion: "skipped",
    ...skippedCheckOutput(why),
    externalId,
  });

  if (reason !== null) {
    yield* quietly(github.createCheckRun(ref, checkName, pull.headSha, skipped(reason)));

    return;
  }

  const [last] = yield* db
    .select({ headSha: review.headSha, conclusion: review.checkConclusion })
    .from(review)
    .where(
      and(
        eq(review.repositoryId, repositoryId),
        // This head's own row counts too, from any PR: check runs belong to the commit, so a new
        // PR on a failed commit must not post a fresh run over that failure.
        or(eq(review.prNumber, pull.number), eq(review.headSha, pull.headSha)),
        isNotNull(review.checkConclusion),
        isNotNull(review.finishedAt),
      ),
    )
    // This head's own result first, so a newer head's pass never overrides a failure judged here.
    .orderBy(sql`${review.headSha} = ${pull.headSha} desc`, desc(review.finishedAt))
    .limit(1)
    .pipe(Effect.orDie);

  if (last === undefined || last.conclusion === null) return;

  yield* quietly(
    github.createCheckRun(ref, checkName, pull.headSha, {
      status: "completed",
      conclusion: last.conclusion,
      ...carriedCheckOutput(last.headSha, last.conclusion),
      externalId,
    }),
  );
});

/** Fail reviews a dead worker left running. Longer than the job timeout and its retries. */
export const sweepStuckReviews = Effect.gen(function* () {
  const db = yield* Database;
  const github = yield* GitHub;
  const settings = yield* Settings;

  const swept = yield* db
    .update(review)
    .set({ status: "failed", error: "Stuck", checkConclusion: "neutral", finishedAt: sql`now()` })
    .where(and(eq(review.status, "running"), lt(review.startedAt, sql`now() - interval '2 hours'`)))
    .returning({ id: review.id, repositoryId: review.repositoryId, checkRunId: review.checkRunId })
    .pipe(Effect.orDie);

  const stranded = swept.flatMap(({ checkRunId, ...row }) =>
    checkRunId === null ? [] : [{ ...row, checkRunId }],
  );

  if (stranded.length === 0) return;

  const repos = yield* db
    .select({
      id: repository.id,
      installationId: repository.installationId,
      fullName: repository.fullName,
    })
    .from(repository)
    .where(inArray(repository.id, [...new Set(stranded.map((row) => row.repositoryId))]))
    .pipe(Effect.orDie);

  const byId = new Map(repos.map((repo) => [repo.id, repo]));

  // The run a dead worker left `in_progress` would otherwise hold a required check forever.
  yield* Effect.forEach(
    stranded,
    ({ id, repositoryId, checkRunId }) => {
      const repo = byId.get(repositoryId);

      if (repo === undefined) return Effect.void;
      const reviewUrl = `${settings.appUrl}/app/reviews/${id}`;

      return quietly(
        github.updateCheckRun(toRepoRef(repo.installationId, repo.fullName), checkRunId, {
          status: "completed",
          conclusion: "neutral",
          ...failedCheckOutput(reviewUrl),
          detailsUrl: reviewUrl,
        }),
      );
    },
    { concurrency: 5, discard: true },
  );
}).pipe(Effect.withSpan("review.sweep"));

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
  const appLogin = `${settings.appSlug}[bot]`;

  const [found] = yield* db
    .select({ repo: repository, suspended: installation.suspended })
    .from(repository)
    .innerJoin(installation, eq(installation.id, repository.installationId))
    .where(eq(repository.id, payload.repositoryId))
    .pipe(Effect.orDie);

  if (found === undefined || found.suspended || !found.repo.enabled) return;
  const { repo } = found;

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

    // Reviews run on a mention unless the repo opts in to opens or pushes.
    const idle =
      payload.trigger === "opened" && !config.triggerOnOpen
        ? "not requested; reviews run on a mention"
        : payload.trigger === "pushed" && !config.triggerOnUpdates
          ? "reviews on new pushes are off"
          : null;

    if (reason !== null || idle !== null) {
      yield* Effect.logInfo("review skipped", reason ?? idle);

      if (config.checks.enabled) yield* postUnreviewed(ref, repo.id, pull, reason);

      return;
    }
  }

  const [existing] = yield* db
    .select({
      id: review.id,
      status: review.status,
      summary: review.summary,
      checkRunId: review.checkRunId,
    })
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

  // Findings are saved before anything reaches GitHub, so a retry only finishes publishing.
  // A completed row asked to review again is a new run.
  const resuming =
    existing !== undefined && existing.status !== "completed" && existing.summary !== null;

  // A row still `running` was cut off mid-run (a lapsed lease); its check run is still live and is
  // reused. Any other restart opens a new run, and GitHub shows the newest one.
  const liveRun = existing?.status === "running" ? existing.checkRunId : null;

  const restart = {
    status: "running",
    error: null,
    finishedAt: null,
    startedAt: sql`now()`,
    checkRunId: liveRun,
    checkConclusion: null,
  } as const;

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
      set: resuming
        ? restart
        : {
            ...restart,
            impact: null,
            verdict: null,
            summary: null,
            changes: null,
            confidence: null,
            repeated: null,
            diagram: null,
          },
    })
    .returning({ id: review.id })
    .pipe(Effect.orDie);

  if (row === undefined) return;
  const reviewId = row.id;
  const reviewUrl = `${settings.appUrl}/app/reviews/${reviewId}`;

  const openCheckRun = Effect.gen(function* () {
    const id = yield* quietly(
      github.createCheckRun(ref, checkName, pull.headSha, {
        status: "in_progress",
        ...runningCheckOutput(reviewUrl),
        detailsUrl: reviewUrl,
        externalId: `${pull.number}`,
      }),
    );

    if (id !== null)
      yield* db
        .update(review)
        .set({ checkRunId: id })
        .where(eq(review.id, reviewId))
        .pipe(Effect.orDie);

    return id;
  });

  // A live run is finished whatever the config says now; only a new one waits on `checks.enabled`.
  const checkRunId = liveRun ?? (config.checks.enabled ? yield* openCheckRun : null);

  const finishCheckRun = (run: CheckRunState) =>
    checkRunId === null
      ? Effect.void
      : quietly(github.updateCheckRun(ref, checkRunId, { ...run, detailsUrl: reviewUrl }));

  /** Run the agent, then save its whole result at once. Nothing here touches the PR. */
  const analyse = Effect.gen(function* () {
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
      .select({
        title: finding.title,
        path: finding.path,
        category: finding.category,
        fingerprint: finding.fingerprint,
        reactionsUp: finding.reactionsUp,
        reactionsDown: finding.reactionsDown,
      })
      .from(finding)
      .innerJoin(review, eq(review.id, finding.reviewId))
      .where(
        and(
          eq(finding.repositoryId, repo.id),
          eq(finding.prNumber, pull.number),
          // A failed publish leaves rows nobody saw. They must not silence the same finding here.
          or(
            eq(finding.reviewId, reviewId),
            isNotNull(finding.githubCommentId),
            eq(review.status, "completed"),
          ),
        ),
      )
      .pipe(Effect.orDie);

    const tools = yield* toolsFor(repo.id, ref, {
      prNumber: pull.number,
      headSha: pull.headSha,
      baseSha: pull.baseSha,
    });

    const result = yield* runPanel(
      {
        title: pull.title,
        body: pull.body,
        author: pull.author,
        baseBranch: pull.baseBranch,
        files,
        config,
        rules: rules.map((item) => item.text),
        noise: learned.filter((item) => item.verdict === "noise").map((item) => item.text),
        useful: learned.filter((item) => item.verdict === "useful").map((item) => item.text),
        previousFindings: previous.filter((item) => !isDismissed(item)).map(describeFinding),
        dismissedFindings: previous.filter(isDismissed).map(describeFinding),
      },
      tools,
      {
        specialists: randomBytes(16).toString("hex"),
        verifier: randomBytes(16).toString("hex"),
      },
    );

    const selected = selectFindings(
      result.findings,
      files,
      config,
      new Set(previous.map((item) => item.fingerprint)),
    );

    const placed = selected.posted;
    const dismissed = new Set(previous.filter(isDismissed).map((item) => item.fingerprint));
    // A finding the team voted down stays quiet even when the model raises it again.
    const repeated = selected.repeated.filter((item) => !dismissed.has(item.fingerprint));

    yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx
            .update(review)
            .set({
              impact: result.impact,
              verdict: sanitize(result.verdict),
              summary: sanitize(result.summary),
              changes: result.changes.slice(0, 8).map(sanitize),
              repeated,
              diagram: config.diagram ? (result.diagram ?? null) : null,
              model: claude.model,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
            })
            .where(eq(review.id, reviewId));

          if (placed.length === 0) return;
          yield* tx.insert(finding).values(
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
              scenario: item.scenario === null ? null : sanitize(item.scenario),
              evidence: item.evidence === null ? null : sanitize(item.evidence),
              suggestion: item.suggestion ?? null,
              fingerprint: item.fingerprint,
              githubCommentId: null,
            })),
          );
        }),
      )
      .pipe(Effect.orDie);
  });

  /** Post what is not on GitHub yet, keeping each id as soon as it is known. */
  const publishFindings = Effect.gen(function* () {
    const stored = yield* db
      .select()
      .from(finding)
      .where(eq(finding.reviewId, reviewId))
      .orderBy(finding.id)
      .pipe(Effect.orDie);

    const unposted = stored.filter((item) => item.githubCommentId === null);

    if (unposted.length === 0) return stored;

    // Anyone can write our marker in a comment; only the App's own comments count.
    const earlier = yield* github.listReviewComments(ref, pull.number);
    const onThePull = byFingerprint(earlier.filter(({ author }) => author === appLogin));

    const toPost = unposted.filter((item) => !onThePull.has(item.fingerprint));
    const posted = yield* publishInline(ref, pull, toPost.map(toPlaced));
    const ids = new Map([...onThePull, ...byFingerprint(posted)]);

    const placed = unposted.flatMap((item) => {
      const githubCommentId = ids.get(item.fingerprint);

      return githubCommentId === undefined ? [] : [{ id: item.id, githubCommentId }];
    });

    yield* Effect.forEach(
      placed,
      ({ id, githubCommentId }) =>
        db.update(finding).set({ githubCommentId }).where(eq(finding.id, id)),
      { discard: true },
    ).pipe(Effect.orDie);

    return stored.map((item) => ({
      ...item,
      githubCommentId: item.githubCommentId ?? ids.get(item.fingerprint) ?? null,
    }));
  });

  /** The comment to edit: the newest stored id on this PR, else one a lost write left behind. */
  const summaryComment = Effect.gen(function* () {
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

    if (last?.commentId !== undefined && last.commentId !== null) return last.commentId;
    const comments = yield* github.listIssueComments(ref, pull.number);

    const ours = comments.filter(
      ({ author, body }) => author === appLogin && body.includes(summaryMarker),
    );

    return ours.at(-1)?.id ?? null;
  });

  const work = Effect.gen(function* () {
    if (!resuming) yield* analyse;

    const stored = yield* publishFindings;

    const [saved] = yield* db
      .select({
        impact: review.impact,
        verdict: review.verdict,
        summary: review.summary,
        changes: review.changes,
        repeated: review.repeated,
        diagram: review.diagram,
      })
      .from(review)
      .where(eq(review.id, reviewId))
      .pipe(Effect.orDie);

    // Repeats an earlier head raised count with what this head posted, or a push past an unfixed
    // critical would read 5/5 and pass.
    // A finding the team voted down no longer counts, even one this head posted.
    const repeated = saved?.repeated ?? [];
    const counted = stored.filter((item) => !isDismissed(item));
    const open = openFindings(counted, repeated);
    const confidence = confidenceOf(open);
    const posted = new Set(stored.map((item) => item.fingerprint));

    // Earlier completed reviews on this PR, plus this one.
    const [earlier] = yield* db
      .select({ total: count() })
      .from(review)
      .where(
        and(
          eq(review.repositoryId, repo.id),
          eq(review.prNumber, pull.number),
          eq(review.status, "completed"),
          ne(review.id, reviewId),
        ),
      )
      .pipe(Effect.orDie);

    const summaryCommentId = yield* github.upsertComment(
      ref,
      pull.number,
      yield* summaryComment,
      renderSummary({
        impact: saved?.impact ?? null,
        verdict: saved?.verdict ?? null,
        changes: saved?.changes ?? [],
        summary: saved?.summary ?? "",
        confidence,
        diagram: saved?.diagram ?? undefined,
        findings: stored.map(toPlaced),
        unplaced: stored.filter((item) => item.githubCommentId === null).map(toPlaced),
        stillOpen: repeated.filter((item) => !posted.has(item.fingerprint)),
        reviewUrl,
        retriggerUrl: `${reviewUrl}/retrigger`,
        badgesUrl: `${settings.appUrl}/badges`,
        reviewCount: (earlier?.total ?? 0) + 1,
        commit: {
          sha: pull.headSha,
          url: `https://github.com/${repo.fullName}/commit/${pull.headSha}`,
        },
      }),
    );

    const conclusion = checkConclusion(open, confidence, config.checks);

    // Before the row turns `completed`: a crash in between leaves `running`, and the retry reuses this run.
    yield* finishCheckRun({
      status: "completed",
      conclusion,
      ...completedCheckOutput({
        summary: saved?.summary ?? "",
        confidence,
        findings: open,
        gate: config.checks,
        reviewUrl,
      }),
    });

    yield* db
      .update(review)
      .set({
        status: "completed",
        confidence,
        summaryCommentId,
        checkConclusion: conclusion,
        finishedAt: sql`now()`,
      })
      .where(eq(review.id, reviewId))
      .pipe(Effect.orDie);
  });

  yield* work.pipe(
    // Finalizers run uninterruptibly, so a defect or a timeout also leaves `running`.
    Effect.onExit((exit) =>
      Exit.isSuccess(exit)
        ? Effect.void
        : db
            .update(review)
            .set({
              status: "failed",
              error: describeFailure(exit.cause),
              checkConclusion: "neutral",
              finishedAt: sql`now()`,
            })
            .where(eq(review.id, reviewId))
            .pipe(
              Effect.orDie,
              Effect.andThen(
                finishCheckRun({
                  status: "completed",
                  conclusion: "neutral",
                  ...failedCheckOutput(reviewUrl),
                }),
              ),
            ),
    ),
  );
});

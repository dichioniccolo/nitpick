# Decisions

<!--
Stage 2. The grilling log. One entry per resolved branch-closing question,
newest last. Unresolved questions live in ops/manifest.json `openQuestions`
until they land here. Deferred questions get an entry too, marked DEFERRED
with the reason.
-->

## 2026-11-02: mechanism

**Question:** Check run or commit status?

**Answer:** Check run (Checks API), settled by research, not asked.

**Rationale:** nitpick is a GitHub App; check runs give `neutral` and `skipped`, Markdown output, re-run and
app pinning for required checks. Commit statuses are meant for non-App integrations (RESEARCH.md, GitHub
Checks API).

## 2026-11-02: conclusion rule

**Question:** What makes the check conclude `failure`?

**Answer:** `failure` when a published finding is at or above a fail threshold (default `critical`);
otherwise `success`.

**Rationale:** The operator wants a real pass/fail signal that teams can require. Rejected: `neutral` on
findings (Bugbot default, never blocks) and `success` once reviewed (Greptile and CodeRabbit, no signal from
findings). Recommended answer taken.

## 2026-11-02: conclusion on review error

**Question:** Conclusion when the review itself errors (crash, timeout, GitHub 5xx after retries)?

**Answer:** `neutral`, with a summary saying the review failed and a dashboard link.

**Rationale:** A nitpick outage must not block merges. Rejected: `failure` (fail closed) and a configurable
flag (CodeRabbit `fail_commit_status`), not worth the surface now. Recommended answer taken.

## 2026-11-02: skipped reviews

**Question:** What happens on reviews nitpick skips (draft, ignored author or path, skip label, base branch
not listed, repo disabled)?

**Answer:** Post a completed run with conclusion `skipped` and the reason.

**Rationale:** Required checks pass on `skipped`, so a skipped PR is never stuck on "Expected". Rejected: no
check (blocks required checks forever) and `neutral` (same effect, less precise). Recommended answer taken.

## 2026-11-02: re-run

**Question:** Support "Re-run" from the Checks tab?

**Answer:** Yes, `check_run.rerequested` only, mapped to the existing `ReviewPullRequest` job.

**Rationale:** Needed once the check is required and a run ended `neutral` on error. Rejected: custom action
buttons via `requested_action` (more surface, no current need) and no re-run (comment trigger only).
Recommended answer taken.

## 2026-11-02: annotations

**Question:** Attach findings as check annotations too?

**Answer:** No. Check output carries counts, the summary and the dashboard link.

**Rationale:** Inline review comments already sit on the lines; annotations would duplicate every finding.
Rejected: duplicate all, annotate only findings GitHub refused inline. Recommended answer taken.

## 2026-11-02: default

**Question:** On by default or opt-in?

**Answer:** On by default; `.nitpick.json` can disable it. Installations without the Checks permission skip
it silently until the owner accepts.

**Rationale:** Discoverable without breaking anyone. Rejected: opt-in (hidden) and always on with no toggle.
Recommended answer taken.

## 2026-11-02: pushes with updates off

**Question:** A push arrives and `triggerOnUpdates` is off (the default), so nitpick does not re-review. What
does the new head's check show?

**Answer:** Carry forward the last reviewed head's conclusion, with a summary naming the source commit and
pointing at Re-run or `@nitpick review` to review this one.

**Rationale:** Otherwise any push turns a failing check into a passing `skipped` one, which defeats the gate.
Rejected: `skipped` (weak gate) and `neutral` with a hint (also passes). Recommended answer taken. Refines the
"skipped reviews" decision: `skipped` covers the skip reasons, not updates being off.

## 2026-11-02: fail threshold

**Question:** Should the fail threshold be configurable?

**Answer:** Yes. `.nitpick.json` gains `checks: { enabled?: boolean, failOn?: "critical" | "major" | "minor" |
"never" }`, defaults `enabled: true`, `failOn: "critical"`. Only published findings count; `never` makes the
check report-only.

**Rationale:** Teams want different gates. Rejected: fixed `critical` (no knob) and failing on any published
finding (couples the gate to strictness). The `enabled` key folds in the earlier "default on" decision.
Recommended answer taken.

## 2026-11-02: creation time

**Question:** When is the run first created?

**Answer:** In the worker, `in_progress`, right after the review row upsert (Reviewer.ts:252-270). Skipped and
carried-forward runs are created already completed where the reviewer returns early.

**Rationale:** Keeps GitHub writes out of the webhook request path and the web bundle. Rejected: `queued` at
webhook time, and `queued` at job claim plus `in_progress` at start (two writes for little gain). Recommended
answer taken.

## 2026-11-02: check name

**Question:** Which name does the run use?

**Answer:** The fixed constant `nitpick`.

**Rationale:** The name is the required-check context; it must never change. App pinning (`app_id`) already
separates self-hosted deployments. Rejected: `GITHUB_APP_SLUG` (changes with the slug) and `nitpick review`.
Recommended answer taken.

## 2026-11-02: derived calls (not asked)

- A `rerequested` run reuses the `requested` trigger, which reviews the PR's current head; the old head's run
  stays as it was.
- A missing Checks permission (403) logs and continues; the review still publishes. A dashboard hint is
  DEFERRED: no evidence yet that owners miss the permission prompt.
- The retry path (`resuming`) and `sweepStuckReviews` complete the same run, found through a new
  `review.checkRunId` column.

## 2026-11-02: shape review

**Question:** Does BRIEF.md match the picture (check `nitpick`, gate by `failOn`, neutral on error, skipped on
skip reasons, carry-forward, Re-run; appetite one PR, about two days)?

**Answer:** Yes, as drafted.

**Rationale:** Operator confirmed. Rejected: bigger appetite, changes.

## 2026-11-02: store the conclusion

**Question:** Store the check conclusion on the `review` row, or recompute it from findings?

**Answer:** Store it, in the same migration as `checkRunId`.

**Rationale:** Carry-forward copies what was shown, and a later `failOn` change never re-judges old heads.
Leaves room for a dashboard pass/fail badge. Rejected: recompute (no column, but history shifts).
Recommended answer taken.

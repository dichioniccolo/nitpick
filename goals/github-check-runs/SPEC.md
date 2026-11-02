# GitHub check runs spec

Source exploration: [`explorations/github-check-runs`](../../explorations/github-check-runs/README.md)
([brief](../../explorations/github-check-runs/BRIEF.md), [map](../../explorations/github-check-runs/MAP.md),
[decisions](../../explorations/github-check-runs/DECISIONS.md)).

## Objective

Every PR head nitpick sees gets a check run named `nitpick`:

| Situation                              | Run                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Review starts                          | created `in_progress`, `details_url` = `${APP_URL}/app/reviews/<id>`   |
| Review publishes, no finding >= failOn | `completed` `success`                                                  |
| Review publishes, a finding >= failOn  | `completed` `failure`                                                  |
| Review errors, times out or is swept   | `completed` `neutral`, "review failed" plus dashboard link             |
| A skip reason applies                  | created `completed` `skipped` with the reason                          |
| Push with `triggerOnUpdates` off       | created `completed` with the last reviewed head's stored conclusion    |
| Re-run clicked on a `nitpick` run      | `check_run.rerequested` queues `ReviewPullRequest` trigger `requested` |

## Non-goals

- Commit statuses.
- Check annotations; inline review comments stay the line-level surface.
- Custom action buttons (`requested_action`).
- A fail-closed option on errors.
- Creating runs in the webhook request path.
- Dashboard UI for installs missing the Checks permission.

## Source hierarchy

1. The source exploration's `DECISIONS.md` and `BRIEF.md`.
2. `CLAUDE.md` and required skills.
3. `standards/ARCHITECTURE.md`.
4. This `SPEC.md`.
5. `PLAN.md`.
6. `GOAL.md`.
7. Supporting `research/`, `ops/` and `history/` files.

## Target surfaces

- `packages/review/domain`: `CheckConclusion` literals; `RepoConfig.checks: { enabled?, failOn? }` with
  defaults `enabled: true`, `failOn: "critical"`; `failOn` is `critical | major | minor | never`.
- `packages/review/use-cases`: pure `checkConclusion(publishedFindings, failOn)` and check output render
  (title with counts per severity, summary, dashboard link), beside `selectFindings` and `renderSummary`.
- `packages/drivers/github`: `createCheckRun` and `updateCheckRun` on `GitHubApi` (`checks.create`,
  `checks.update`).
- `packages/review/tables`: `review.checkRunId` and `review.checkConclusion`, one migration.
- `packages/review/server`: hooks in `Reviewer.ts` (start, finish, `onExit`, skip returns, updates-off
  return, `sweepStuckReviews`) and `check_run.rerequested` in `Webhooks.ts` `jobsFor`.
- `packages/review/server/test/flow.test.ts`: `fakeGitHub` gains the new methods.
- `README.md`: app setup adds Checks read and write and the Check run event.

## Constraints

- The run name is the constant `nitpick`; it is a public required-check context and never changes.
- A 403 from the checks endpoints (permission not accepted) logs and continues; it never fails the review.
  Other check errors also never fail the review.
- `checkRunId` is saved right after the run is created. A retry of a row still `running` (a lapsed lease)
  updates that run, even if `checks.enabled` turned off; any other restart opens a new run.
- `sweepStuckReviews` completes a stranded run `neutral`.
- Only published findings count toward `failOn`; `never` always concludes `success`.
- The stored `checkConclusion` is what carry-forward copies; it is never recomputed.
- Model text in check output passes `sanitize`; summary truncates under 65535 characters.
- `RepoConfig` is read from the base commit, as today.
- GitHub writes happen in the worker only; the web bundle gains no checks call.

## Acceptance criteria

- [ ] `flow.test.ts` covers: run created `in_progress` then `success`; `failure` with a critical finding;
      `failOn: "major"` fails on a major; `failOn: "never"` succeeds; `neutral` on a review error; `skipped`
      on a draft; carry-forward on a push with updates off; `checks.enabled: false` posts nothing; 403 leaves
      the review `completed`; a retry updates the same run.
- [ ] Webhook test: `check_run.rerequested` for a `nitpick` run queues `ReviewPullRequest` with trigger
      `requested`; other check names are ignored.
- [ ] Use-cases unit tests for `checkConclusion` and output truncation.
- [ ] Migration generated with `bun run db:generate --name review_check_runs`.
- [ ] README lists the Checks permission and Check run event.
- [ ] No unrelated refactors or formatting churn.

## Verification matrix

| Check          | Command or evidence                                          | Required result |
| -------------- | ------------------------------------------------------------ | --------------- |
| Launcher size  | `test "$(wc -m < goals/github-check-runs/GOAL.md)" -le 4000` | Passes          |
| Manifest JSON  | `jq . goals/github-check-runs/ops/manifest.json`             | Passes          |
| Lint and types | `bun run lint && bun run check`                              | Passes          |
| Tests          | `bun run test`                                               | Passes          |

## Stop conditions

- Required source files are missing or materially contradictory.
- Any spend: purchases, paid services, quota top-ups or plan changes need the operator.
- The same blocker repeats after reasonable investigation.

Scope growth, destructive side effects and policy calls are not stops: decide them and record each in the
Decision log.

## Decision log

Seeded from the exploration's [`DECISIONS.md`](../../explorations/github-check-runs/DECISIONS.md).

| Date       | Decision                                                                                                  | Reason                                                                           | How to reverse                              |
| ---------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| 2026-11-02 | Check runs, not commit statuses                                                                           | GitHub App; neutral, skipped, re-run                                             | Swap driver calls                           |
| 2026-11-02 | `failure` on a published finding >= `failOn`                                                              | Real gate teams can require                                                      | Default `failOn: "never"`                   |
| 2026-11-02 | `neutral` on review error                                                                                 | Outage never blocks merges                                                       | Change one mapping                          |
| 2026-11-02 | `skipped` on skip reasons                                                                                 | Required checks do not hang                                                      | Change one mapping                          |
| 2026-11-02 | Carry forward on un-reviewed pushes                                                                       | A push must not clear a failing gate                                             | Post `skipped` instead                      |
| 2026-11-02 | Re-run via `check_run.rerequested` only                                                                   | Recover from `neutral` errors                                                    | Drop the webhook branch                     |
| 2026-11-02 | No annotations                                                                                            | Inline comments already cover lines                                              | Add annotations to `updateCheckRun`         |
| 2026-11-02 | On by default, `checks.enabled` to disable                                                                | Discoverable, removable                                                          | Flip default                                |
| 2026-11-02 | Created in the worker at review start                                                                     | No GitHub writes in the web request path                                         | Move creation                               |
| 2026-11-02 | Fixed name `nitpick`                                                                                      | Stable required-check context                                                    | Never; breaks branch protection             |
| 2026-11-02 | Store `checkConclusion` on `review`                                                                       | History stays as shown                                                           | Down-migration drops the column             |
| 2026-11-02 | Reuse a run only when the row is still `running` (lapsed lease); any other restart opens a new run        | A completed run is not reopened; GitHub shows the newest run per name            | Reopen the stored run instead               |
| 2026-11-02 | No check for a disabled repo, a suspended install, a closed PR or a stale head                            | nitpick is off, cannot write, or a newer job owns the head                       | Post `skipped` there too                    |
| 2026-11-02 | Check output builders live in `review/use-cases/src/Check.ts`; `severityRank` exported from `Findings.ts` | Pure, beside `selectFindings`                                                    | Inline them                                 |
| 2026-11-02 | Carry-forward reads this head's own row too                                                               | Review round 1 F1: a force-push back to a failed head posted a passing `skipped` | Re-add the head filter (reopens the bypass) |
| 2026-11-02 | `external_id` is the PR number on every run; Re-run falls back to it                                      | Fork runs carry no `pull_requests`, and skipped runs are not stored              | Drop the fallback                           |
| 2026-11-02 | Check writes time out after 15 s and count as failed                                                      | A hung write must not hold the review or its finalizer                           | Remove the timeout                          |

## Exception ledger

| Exception | Scope | Owner | Rationale | Removal condition |
| --------- | ----- | ----- | --------- | ----------------- |
| None      | N/A   | N/A   | N/A       | N/A               |

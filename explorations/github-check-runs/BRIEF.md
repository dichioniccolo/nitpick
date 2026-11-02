# Brief

<!--
Stage 3. The shaped pitch (Shape Up anatomy). Fat-marker fidelity: concrete
enough to evaluate and decompose, rough enough to leave design latitude to
the implementing goal packets. The exploration is shaped when the human says
this file matches the picture in their head.
-->

## Problem

nitpick only speaks through a sticky summary comment and inline comments. A PR's merge box shows nothing from
it: no "running", no pass or fail, nothing a team can require in branch protection. Greptile, CodeRabbit and
Bugbot all show up as a check (RESEARCH.md). We want the same, with a real gate: the check fails when nitpick
publishes a finding at or above a threshold.

## Appetite

Small batch: one PR, about two days. One check run per reviewed head, no new pages, no action buttons. If it
grows past that, cut carry-forward polish before cutting the gate itself.

## Solution sketch

A check run named `nitpick` on every PR head nitpick sees.

```text
review starts        -> create run   in_progress   "Reviewing…"          details_url = /app/reviews/<id>
review publishes     -> update run   completed     success | failure     title "2 critical, 1 major", summary
review errors        -> update run   completed     neutral               "Review failed", dashboard link
skip reason          -> create run   completed     skipped               reason
push, updates off    -> create run   completed     <last conclusion>     "Carried from <sha>; Re-run to review"
Re-run clicked       -> check_run.rerequested -> ReviewPullRequest(trigger "requested")
```

- **Conclusion** is pure: published findings plus `checks.failOn` give `success` or `failure`. Lives in
  `review/use-cases` beside `selectFindings`; output text beside `renderSummary`, passed through `sanitize`.
- **Driver**: `GitHubApi` gains create and update check run (`checks.create`, `checks.update`); a 403 for a
  missing permission is a typed error the reviewer swallows with a log line.
- **Reviewer**: hooks at the start (after the review upsert), finish (`completed`), `onExit` failure, the
  early skip returns and the updates-off return. `review.checkRunId` (migration) lets a retry and
  `sweepStuckReviews` close the same run.
- **Config**: `RepoConfig.checks: { enabled, failOn }`, read from the base commit like the rest.
- **Webhook**: `jobsFor` maps `check_run.rerequested` for a run named `nitpick` to the review job.
- **Docs**: README app setup adds Checks read and write and the Check run event.

## Rabbit holes

- **Permission rollout**: existing installs lack Checks until an owner accepts. Patched: 403 is logged, never
  fails the review.
- **Carry-forward source**: needs the last completed review on the PR with its conclusion. Store the
  conclusion on `review` rather than recomputing from findings, so a later `failOn` change does not rewrite
  history.
- **Retry duplicates**: a job retry after the run was created must update it, not create a second. Patched by
  `checkRunId` written in the same step that creates the run.
- **Stuck runs**: a worker death leaves a run `in_progress`; `sweepStuckReviews` must complete it `neutral`.
- **Output limits**: summary capped at 65535 characters; truncate rather than fail.
- **Hostile content**: finding text in the summary is model output; `sanitize` applies.

## No-gos

- No commit statuses.
- No annotations; inline comments stay the line-level surface.
- No custom action buttons (`requested_action`).
- No fail-closed option on errors; errors are always `neutral`.
- No check creation in the webhook request path.
- No dashboard UI for the missing-permission case (deferred).

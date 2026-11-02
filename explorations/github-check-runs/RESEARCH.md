# Research

## 2026-11-02: external landscape

### What peers do

- **Greptile**: `greptile.json` has a boolean `statusCheck`, "Create a GitHub status check for each review"
  ([reference](https://www.greptile.com/docs/code-review/greptile-json-reference.md)). Its docs do not say
  whether it is a check run or a commit status, what it shows, or what makes it fail. One public repo shows a
  required check named "Greptile Review" pinned to its app, concluding `success` once the head is reviewed even
  with a P1 finding; merges were held by unresolved Greptile threads (`required_conversation_resolution`), and
  no check appeared when trial credits ran out ([workspacejson/integrations#13](https://github.com/workspacejson/integrations/pull/13)).
  Unverified: a merge-protection section on the trigger page
  ([trigger-code-review](https://www.greptile.com/docs/code-review-bot/trigger-code-review)).
- **CodeRabbit**: `reviews.commit_status` (default on) posts `CodeRabbit`, pending during review, success at
  the end, including skipped or rate-limited reviews. `reviews.fail_commit_status` (default off) fails only a
  review that errored; otherwise the check run ends `neutral`. Findings never fail it
  ([configuration](https://docs.coderabbit.ai/reference/configuration)).
- **Cursor Bugbot**: check `Cursor Bugbot`. `success` when no issues and no unresolved prior comments;
  `neutral` on issues, cancellation by a newer commit, or internal error; `failure` only with "fail on
  unresolved issues" on. "Requiring the status alone does not block merges on findings"
  ([bugbot](https://cursor.com/docs/bugbot)).
- **Copilot code review** and **Graphite Agent**: no documented pass/fail check
  ([copilot](https://docs.github.com/en/copilot/concepts/agents/code-review)).

Pattern: every documented tool reports "review done", not "code clean". Failing on findings is opt-in.

### GitHub Checks API

- Only GitHub Apps can write checks; needs the Checks permission at write
  ([check runs](https://docs.github.com/en/rest/checks/runs)).
- `POST /repos/{owner}/{repo}/check-runs` (`octokit.rest.checks.create`) needs `name` and `head_sha`;
  optional `details_url`, `external_id`, `status`, `conclusion`, `output`. `PATCH .../check-runs/{id}`
  updates it ([check runs](https://docs.github.com/en/rest/checks/runs),
  [octokit create](https://raw.githubusercontent.com/octokit/plugin-rest-endpoint-methods.js/main/docs/checks/create.md)).
- `status`: `queued`, `in_progress`, `completed`. `conclusion`: `success`, `failure`, `neutral`,
  `cancelled`, `skipped`, `timed_out`, `action_required`.
- `output.title` and `output.summary` required; `summary` and `text` Markdown up to 65535 chars; annotations
  50 per request, further PATCHes append.
- Up to 3 action buttons, shown after completion; a click sends `check_run.requested_action`. A re-run from
  the UI sends `check_run.rerequested` to the creating app only
  ([checks guide](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks),
  [webhook events](https://docs.github.com/en/webhooks/webhook-events-and-payloads)).
- Runs are keyed to `head_sha`; a new push needs a new run.
- Required checks pass on `success`, `skipped` or `neutral`
  ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
  The run `name` is the required-check context and can be pinned to the app (`app_id` in branch protection,
  `integration_id` in rulesets) ([branch protection](https://docs.github.com/en/rest/branches/branch-protection),
  [rules](https://docs.github.com/en/rest/repos/rules)). So the name must stay stable.
- Commit statuses (`error|failure|pending|success`) are simpler and meant for non-App integrations; only
  checks fill the Checks tab ([statuses](https://docs.github.com/en/rest/commits/statuses),
  [about status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks)).
  Check runs fit nitpick.

## 2026-11-02: in-repo capability inventory

- **GitHub driver** `@nitpick/github`, `packages/drivers/github/src/index.ts`: `GitHubApi` port (:75-122),
  `GitHub` service (:190), installation Octokit per call (:203), `call(op, fn)` wraps in `Effect.tryPromise`
  with span `github.<op>` (:177-181), `GitHubError {operation, status, cause}` (:11-15). Wraps pulls, reviews,
  comment upsert (:338-366), reactions, collaborator permission. `checks.create` / `checks.update`: NOT FOUND.
  Commit statuses: NOT FOUND.
- **Webhooks** `packages/review/server/src/Webhooks.ts`: `jobsFor` (:102-199) handles `installation`,
  `installation_repositories`, `pull_request` (opened, reopened, ready_for_review, synchronize), `push`,
  `issue_comment` (`@slug review`). `check_run` / `check_suite`: NOT FOUND (fall to `Match.orElse`, :197).
  Delivery dedupe and enqueue in one transaction (:207-240).
- **Queue** `packages/review/server/src/Queue.ts`: dedupe key `review:repo:pr:sha` (:18), 3 attempts (:12),
  3 minute lease, backoff.
- **Reviewer** `packages/review/server/src/Reviewer.ts`:
  - early returns before a review row exists (disabled, closed PR, stale head, skip reasons, already
    completed) at :191-238;
  - start point after the review upsert, `reviewId` known, status `running` (:252-270); `resuming` reuses
    saved findings (:242);
  - finish point sets `completed` with `summaryCommentId` (:472-476);
  - failure point `Effect.onExit` sets `failed` and `error` on defects and timeouts too (:479-490);
  - `sweepStuckReviews` fails rows still `running` after 2 hours (:163-170).
- **Outcome inputs** `packages/review/use-cases/src/Findings.ts`: `selectFindings` (:33-63), strictness floor
  strict→minor, balanced→major, relaxed→critical (:12-16). `Render.ts` `renderSummary` (:147-180) already
  counts per severity and shows "Confidence to merge N/5" (:160).
- **Config** `RepoConfig` in `packages/review/domain/src/index.ts:60-71`, read from the base commit by
  `loadConfig` (Reviewer.ts:45-59). No pass/fail threshold: NOT FOUND.
- **Tables** `packages/review/tables/src/review.table.ts`: `review` status enum
  `running|completed|skipped|failed` (:71), `summaryCommentId` (:81) is the pattern for a `checkRunId`
  column (NOT FOUND today). `skipped` is never written by the server.
- **Details target**: `apps/web/src/app/app/reviews/[id]/page.tsx`, gated by `repository_member` through
  `Dashboard.review` (Dashboard.ts:181-204). Summary comment already links `${APP_URL}/app/reviews/<id>`.
- **App permissions** documented by hand in `README.md:36-43`: no Checks permission, no check events.
- **Tests**: `fakeGitHub` in `packages/review/server/test/flow.test.ts:112-181`, installed with
  `Layer.succeed(GitHub, fakeGitHub)`; new port methods must be added there.

## Constraints discovered

- Installed apps must accept a new Checks permission; until an owner approves, `checks.create` returns 403.
  A missing permission must not fail the review.
- Model text in check output passes `sanitize` (CLAUDE.md law), same as the summary comment.
- Check name is a public contract once teams require it; renaming breaks their branch protection.
- A retry (`resuming`) must update the same run, not create a second; `sweepStuckReviews` must also close
  a run left `in_progress`.
- Adding a `checkRunId` column is a migration (`bun run db:generate`).
- `details_url` points at a sign-in page gated by membership; outsiders get `NotFound`, which is correct.

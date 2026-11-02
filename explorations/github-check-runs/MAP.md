# Map

<!--
Stage 4. Decomposition into candidate goal packets. This is the graduation
surface: the definition-of-ready in explorations/README.md is checked against
this file. Every major component cites an existing repo capability or is
explicitly marked NET-NEW.
-->

## Candidate goal packets

| Slug                | Mission                                                                                  | Depends on | Capabilities cited |
| ------------------- | ---------------------------------------------------------------------------------------- | ---------- | ------------------ |
| `github-check-runs` | Post a `nitpick` check run per reviewed head that passes or fails on published findings. | none       | see table below    |

One packet: the appetite is one PR, and every part is needed for the gate to mean anything.

### Components

| Component                                                           | Home               | Capability                                                                    | Status                |
| ------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- | --------------------- |
| `CheckConclusion` literals, `RepoConfig.checks { enabled, failOn }` | `review/domain`    | `packages/review/domain/src/index.ts:60-92`                                   | extend                |
| `checkConclusion(findings, failOn)`, check output render            | `review/use-cases` | `Findings.ts` `selectFindings`, `Render.ts` `renderSummary`                   | extend                |
| `createCheckRun`, `updateCheckRun`, 403 as typed error              | `drivers/github`   | `GitHubApi` port, `call(op, fn)` in `packages/drivers/github/src/index.ts`    | extend                |
| `review.checkRunId`, `review.checkConclusion` columns               | `review/tables`    | `review.table.ts` `summaryCommentId` pattern                                  | extend, **migration** |
| Start, finish, error, skip, carry-forward hooks                     | `review/server`    | `Reviewer.ts:191-238`, `:252-270`, `:472-490`, `sweepStuckReviews` `:163-170` | extend                |
| `check_run.rerequested` to `ReviewPullRequest`                      | `review/server`    | `Webhooks.ts` `jobsFor` `:102-199`                                            | extend                |
| Details target                                                      | `apps/web`         | `apps/web/src/app/app/reviews/[id]/page.tsx`                                  | reuse, no change      |
| GitHub fake                                                         | tests              | `packages/review/server/test/flow.test.ts` `fakeGitHub`                       | extend                |
| App setup docs                                                      | docs               | `README.md:36-43`                                                             | extend                |

NET-NEW: none. Every part extends an existing brick.

Flags: needs a migration (`bun run db:generate --name review_check_runs`). No page, layout or loader changes,
so `bun run e2e` is not required.

## Sequencing

1. Domain and use-cases: conclusion function and output render, unit tested.
2. Driver methods and the fake.
3. Table columns and migration.
4. Reviewer hooks: start and finish first (the first slice), then error and sweep, then skip and
   carry-forward.
5. Webhook `rerequested`.
6. README permissions.

## First vertical slice

A PR opens on a repo whose install has the Checks permission. The fake GitHub records a run created
`in_progress` with `details_url` `/app/reviews/<id>`, then updated `completed` with `failure` when a critical
finding publishes and `success` when none does. Verified in `flow.test.ts` on PGlite.

## Open risks inherited from the brief

- Existing installs lack Checks until an owner accepts; 403 must log and never fail the review.
- A retry must update the stored `checkRunId`, never create a second run.
- `sweepStuckReviews` must complete a stranded run `neutral`.
- Summary over 65535 characters truncates.
- Finding text in check output passes `sanitize`.

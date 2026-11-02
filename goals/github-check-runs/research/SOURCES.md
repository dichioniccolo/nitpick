# GitHub check runs: sources and provenance

- **Source exploration:** `explorations/github-check-runs`; primary ledger:
  [`explorations/github-check-runs/research/SOURCES.md`](../../../explorations/github-check-runs/research/SOURCES.md).
- **Provenance:** [`RESEARCH.md`](../../../explorations/github-check-runs/RESEARCH.md).

## 2. Upstream repositories and licenses

None mined. Peers are closed products; only their public docs are referenced. Nothing ported.

## 3. External research sources

- Greptile `greptile.json` reference: https://www.greptile.com/docs/code-review/greptile-json-reference.md
- Greptile trigger page (merge protection claim unverified): https://www.greptile.com/docs/code-review-bot/trigger-code-review
- Greptile confidence score: https://www.greptile.com/docs/code-review/first-pr-review
- Greptile auto-approve: https://www.greptile.com/docs/code-review/auto-approve-prs.md
- Greptile check observed in the wild: https://github.com/workspacejson/integrations/pull/13
- CodeRabbit configuration: https://docs.coderabbit.ai/reference/configuration
- Cursor Bugbot: https://cursor.com/docs/bugbot
- Copilot code review: https://docs.github.com/en/copilot/concepts/agents/code-review
- Graphite Agent: https://graphite.com/blog/introducing-graphite-agent-and-pricing
- GitHub check runs REST: https://docs.github.com/en/rest/checks/runs
- GitHub checks guide: https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks
- GitHub webhook events: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- GitHub protected branches: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub troubleshooting required checks: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks
- GitHub branch protection REST: https://docs.github.com/en/rest/branches/branch-protection
- GitHub rules REST: https://docs.github.com/en/rest/repos/rules
- GitHub commit statuses REST: https://docs.github.com/en/rest/commits/statuses
- GitHub about status checks: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks
- Octokit checks.create: https://raw.githubusercontent.com/octokit/plugin-rest-endpoint-methods.js/main/docs/checks/create.md
- Octokit checks.update: https://raw.githubusercontent.com/octokit/plugin-rest-endpoint-methods.js/main/docs/checks/update.md

## 4. In-repo capability references

| Brick                                          | Path                                         | Use                                     |
| ---------------------------------------------- | -------------------------------------------- | --------------------------------------- |
| `GitHubApi` port, `GitHub` service             | `packages/drivers/github/src/index.ts`       | extend: add check run create and update |
| Webhook routing `jobsFor`                      | `packages/review/server/src/Webhooks.ts`     | extend if re-run is in scope            |
| Job queue                                      | `packages/review/server/src/Queue.ts`        | reuse                                   |
| `reviewPullRequest` start, finish, fail points | `packages/review/server/src/Reviewer.ts`     | extend                                  |
| `selectFindings`, strictness floor             | `packages/review/use-cases/src/Findings.ts`  | reuse for conclusion                    |
| `renderSummary`                                | `packages/review/use-cases/src/Render.ts`    | reuse or extend for check output        |
| `RepoConfig`                                   | `packages/review/domain/src/index.ts`        | extend if a threshold is configurable   |
| `review` table                                 | `packages/review/tables/src/review.table.ts` | extend: `checkRunId` column (migration) |
| Review page                                    | `apps/web/src/app/app/reviews/[id]/page.tsx` | reuse as `details_url`                  |
| `fakeGitHub`                                   | `packages/review/server/test/flow.test.ts`   | extend                                  |

## 5. Cross-links and provenance

- Exploration: [`RESEARCH.md`](../../../explorations/github-check-runs/RESEARCH.md),
  [`DECISIONS.md`](../../../explorations/github-check-runs/DECISIONS.md),
  [`BRIEF.md`](../../../explorations/github-check-runs/BRIEF.md), [`MAP.md`](../../../explorations/github-check-runs/MAP.md).
- Goal: [`../SPEC.md`](../SPEC.md) decision log.

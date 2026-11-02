# GitHub check runs plan

## Status

Status: `P3 PR`

## Phases

Phase ids match `ops/manifest.json` `phases[]`. A plan must not contradict its own manifest.

| Phase        | Status  | Goal                                                        | Exit criteria                                              |
| ------------ | ------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| P0 Research  | done    | Inspect the source hierarchy and confirm scope.             | Required facts and blockers are recorded.                  |
| P1 Implement | done    | Make the smallest changes that satisfy `SPEC.md`.           | Acceptance criteria are met.                               |
| P2 Verify    | done    | Run required checks and the quality loop; capture evidence. | Verification is green or blockers are documented.          |
| P3 PR        | active  | Open the PR and drive it to merge.                          | Required checks green, review threads resolved, PR merged. |
| P4 Close     | pending | Write the reflection and flip packet state.                 | Status and evidence updated; a reflection exists.          |

## P1 order (from the exploration MAP)

1. Domain and use-cases: `checkConclusion`, output render, unit tests.
2. Driver methods and `fakeGitHub`.
3. Table columns and `bun run db:generate --name review_check_runs`.
4. Reviewer hooks: start and finish (first slice), then error and sweep, then skip and carry-forward.
5. Webhook `check_run.rerequested`.
6. README permissions.

## P4 closeout checklist

1. Copy `_template/history/reflections/_TEMPLATE.md` to `history/reflections/<YYYY-MM-DD>-<agent>.md`.
   Critique the tooling, the implementation and the goal prompt; capture TODOs worth codifying.
2. Set `completionGate.finalPullRequest` in `ops/manifest.json`.
3. Update `README.md` (status, latest evidence) and the manifest phase statuses and `initiative.status`.

## Execution notes

- Preserve unrelated worktree changes.
- Keep `SPEC.md` normative; update it only when the contract changes.
- Keep this plan current; archive old run outputs under `history/`.

## Verification commands

```sh
test "$(wc -m < goals/github-check-runs/GOAL.md)" -le 4000
jq . goals/github-check-runs/ops/manifest.json
bun run lint && bun run check && bun run test
```

# <Goal Title> plan

## Status

Status: `pending`

## Phases

Phase ids match `ops/manifest.json` `phases[]`. A plan must not contradict its own manifest.

| Phase        | Status  | Goal                                                        | Exit criteria                                              |
| ------------ | ------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| P0 Research  | pending | Inspect the source hierarchy and confirm scope.             | Required facts and blockers are recorded.                  |
| P1 Implement | pending | Make the smallest changes that satisfy `SPEC.md`.           | Acceptance criteria are met.                               |
| P2 Verify    | pending | Run required checks and the quality loop; capture evidence. | Verification is green or blockers are documented.          |
| P3 PR        | pending | Open the PR and drive it to merge.                          | Required checks green, review threads resolved, PR merged. |
| P4 Close     | pending | Write the reflection and flip packet state.                 | Status and evidence updated; a reflection exists.          |

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
test "$(wc -m < goals/<slug>/GOAL.md)" -le 4000
jq . goals/<slug>/ops/manifest.json
bun run lint && bun run check && bun run test
```

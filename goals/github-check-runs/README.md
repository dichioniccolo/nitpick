# GitHub check runs

## Status

Lifecycle: `active`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Mission

Post a `nitpick` check run on every PR head: `in_progress` while reviewing, then `success` or `failure` by the `failOn` threshold, `neutral` on errors, `skipped` on skips. Graduated from [`explorations/github-check-runs`](../../explorations/github-check-runs/README.md).

## Launch

```text
follow the instructions in goals/github-check-runs/GOAL.md
```

`GOAL.md` is the compact launcher. `SPEC.md` is the normative contract.

## Read this first

1. [`GOAL.md`](./GOAL.md): compact launcher.
2. [`SPEC.md`](./SPEC.md): normative source of truth.
3. [`PLAN.md`](./PLAN.md): active execution plan.
4. [`ops/manifest.json`](./ops/manifest.json): machine-readable routing.
5. [`research/`](./research/): supporting research, if present.
6. [`history/`](./history/): evidence and closeouts, if present.

## Current phase

P2 Verify. Implementation landed; next: the quality-review-fix-loop, then open the PR.

## Latest evidence

Local: `bun run lint`, `bun run check` and `bun run test` (112 tests) pass on `feat/github-check-runs`.

## Notes

Existing installs must accept the new Checks permission; until then the check silently does not appear.

Backlog from review round 1 (non-blocking):

- A crash between creating a run and saving its id leaves that run `in_progress`; a newer run hides it.
- Swallowed check write errors log operation and status only, not GitHub's message.
- Retargeting a PR to an unlisted base, pushing, then retargeting back leaves `skipped`; `pull_request.edited`
  queues nothing.
- `review.checkRunId` has no index; Re-run lookups scan one repository's reviews.
- The sweep does not retry a failed check update.
- Subscribing to Check run delivers every Actions run's `created` and `completed`; each lands in
  `webhook_delivery`. Watch the volume.

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

P0 Research. Next: read `SPEC.md`, then start P1 step 1 in `packages/review/use-cases`.

## Latest evidence

Not started.

## Notes

Existing installs must accept the new Checks permission; until then the check silently does not appear.

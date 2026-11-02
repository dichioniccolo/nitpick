# GitHub check runs

## Status

<!-- Mirrors ops/manifest.json stage and status. Update both together. -->

Stage: `graduate`
Status: `graduated`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Spark

Make the GitHub integration behave like Greptile: post a check on the PR and show passed or failed when the review finishes.

## Next open question

None. Graduated into [`goals/github-check-runs`](../../goals/github-check-runs/README.md). Reopen at `decompose` if a follow-up (dashboard pass/fail badge, missing-permission hint) is wanted.` when the current stage is clean. Keep this current: it is the
cold-session resume point.>

## Read this first

1. [`ops/manifest.json`](./ops/manifest.json) - machine state: stage, status, open questions.
2. [`CAPTURE.md`](./CAPTURE.md) - raw dump (stage 0).
3. [`RESEARCH.md`](./RESEARCH.md) - prior art + capability inventory (stage 1, if present).
4. [`DECISIONS.md`](./DECISIONS.md) - grilling log (stage 2, if present).
5. [`BRIEF.md`](./BRIEF.md) - shaped pitch (stage 3, if present).
6. [`MAP.md`](./MAP.md) - decomposition (stage 4, if present).

## Trail

- 2026-11-02: research (Greptile, CodeRabbit, Bugbot, Checks API, in-repo inventory), two align rounds, brief confirmed, MAP with one goal; graduated into `goals/github-check-runs`.
- 2026-11-02: packet opened from `/explore`; first capture filed.

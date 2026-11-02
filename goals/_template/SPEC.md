# <Goal Title> spec

## Objective

<State the final result in observable terms.>

## Non-goals

- <Out-of-scope behavior, package, workflow, migration or policy.>

## Source hierarchy

1. User objective or issue that created this packet.
2. `CLAUDE.md` and required skills.
3. `standards/ARCHITECTURE.md`.
4. This `SPEC.md`.
5. `PLAN.md`.
6. `GOAL.md`.
7. Supporting `research/`, `ops/` and `history/` files.

Higher sources outrank lower sources when they conflict.

## Target surfaces

- <Slice package, driver, app, migration or doc this goal may change.>

## Constraints

- <Hard requirement, boundary rule, compatibility concern or quality bar.>

## Acceptance criteria

- [ ] <Observable result that proves the goal is complete.>
- [ ] No unrelated refactors or formatting churn.

## Verification matrix

| Check          | Command or evidence                               | Required result |
| -------------- | ------------------------------------------------- | --------------- |
| Launcher size  | `test "$(wc -m < goals/<slug>/GOAL.md)" -le 4000` | Passes          |
| Manifest JSON  | `jq . goals/<slug>/ops/manifest.json`             | Passes          |
| Lint and types | `bun run lint && bun run check`                   | Passes          |
| Tests          | `bun run test`                                    | Passes          |
| E2E (pages)    | `bun run e2e:build && bun run e2e`                | Passes          |

## Stop conditions

- Required source files are missing or materially contradictory.
- Any spend: purchases, paid services, quota top-ups or plan changes need the operator.
- The same blocker repeats after reasonable investigation.

Scope growth, destructive side effects and policy calls are not stops: decide them and record each in the
Decision log.

## Decision log

| Date | Decision | Reason | How to reverse |
| ---- | -------- | ------ | -------------- |
| None | N/A      | N/A    | N/A            |

## Exception ledger

| Exception | Scope | Owner | Rationale | Removal condition |
| --------- | ----- | ----- | --------- | ----------------- |
| None      | N/A   | N/A   | N/A       | N/A               |

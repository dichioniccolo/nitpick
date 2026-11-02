# GOAL: <short imperative outcome>

Repo root: the current working directory, a nitpick checkout. All paths below are repo-relative.

Outcome: <one sentence describing the final state this execution must reach>.

This is a compact launcher. The packet files are the detailed contract:

- `goals/<slug>/README.md`
- `goals/<slug>/SPEC.md`
- `goals/<slug>/PLAN.md`
- `goals/<slug>/ops/manifest.json`

Read those first, then `CLAUDE.md` and `standards/ARCHITECTURE.md`, and load the `effect-first-development`
and `schema-first-development` skills before writing Effect code. Repo standards outrank packet prose.

Scope:

- In: <paths, packages, docs or workflows this goal may change>.
- Out: <non-goals and areas not to touch>.

Workflow:

1. Work on a branch; a push to `main` deploys.
2. Inspect referenced files and current repo state.
3. Make the smallest change that satisfies `SPEC.md`.
4. Preserve unrelated worktree changes.
5. Tie decisions to evidence from files, tests or command output.
6. Update packet evidence and phase status as readiness changes.
7. Close with the `quality-review-fix-loop` skill, then open the PR.
8. At P4 Close, write a reflection to `history/reflections/<YYYY-MM-DD>-<agent>.md`.

Acceptance:

- [ ] `SPEC.md` acceptance criteria are satisfied.
- [ ] `bun run lint`, `bun run check` and `bun run test` pass; `bun run e2e:build && bun run e2e` too when a
      page, layout or loader changed.
- [ ] A schema change ships as a migration from `bun run db:generate --name <change>`.
- [ ] No unrelated refactors or formatting churn.

Verification:

```sh
test "$(wc -m < goals/<slug>/GOAL.md)" -le 4000
jq . goals/<slug>/ops/manifest.json
```

Decide changes to public API, schema, migrations, auth, infra, dependencies or destructive state yourself
when the goal needs them: record each in the `SPEC.md` Decision Log with its reason and how to reverse it,
then continue. Land the reversal path for an irreversible change before it merges.

Done only when the PR merges with required checks green and the closeout lands, or when a blocker that needs
the operator is reported with file or command evidence.

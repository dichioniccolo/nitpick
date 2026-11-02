# Goals

Durable goal packets for repo initiatives. A packet is a docs-as-code contract: it gives humans and agents a
persistent objective, source hierarchy, decisions, verification surface, stop conditions and evidence trail.
Adapted from beep-effect (Apache-2.0) without its `beep goals` CLI.

Packets are usually born from a graduated exploration in [`explorations/`](../explorations/README.md) and keep
a back-link to it in `ops/manifest.json` `provenance.exploration`.

## Packet standard

New execution-capable packets start from [`_template`](./_template). A reference-only packet may drop
`GOAL.md` only when its `README.md` and manifest mark it `reference` with a reason.

```text
goals/<slug>/
  README.md
  SPEC.md
  PLAN.md
  GOAL.md
  ops/manifest.json
  research/SOURCES.md
  history/reflections/
```

| Path                  | Role                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| `README.md`           | Orientation: status, mission, next action, launcher, reading order, evidence.    |
| `SPEC.md`             | Normative contract: scope, non-goals, constraints, decisions, acceptance, stops. |
| `PLAN.md`             | Mutable plan: phases, sequencing, verification, current blockers.                |
| `GOAL.md`             | Compact launcher for an execution agent. Delegates to `SPEC.md`; never the spec. |
| `ops/manifest.json`   | Machine-readable routing: lifecycle, anchor document, launcher, phases, checks.  |
| `research/SOURCES.md` | Provenance ledger inherited from the exploration at graduation.                  |
| `history/`            | Closeouts, reflections, verification notes.                                      |

## Launcher rule

- `GOAL.md` references the packet docs instead of duplicating the contract.
- Target 3,500 characters, hard maximum 4,000: `test "$(wc -m < goals/<slug>/GOAL.md)" -le 4000`.
- Launch a session with: `follow the instructions in goals/<slug>/GOAL.md`.

## Lifecycle

`initiative.status` in `ops/manifest.json` is canonical; the README `Lifecycle:` line mirrors it. Update both
together.

| State                | Meaning                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `active`             | Execution is open; the packet has `GOAL.md`.                               |
| `paused`             | Stopped on purpose, including not started; resume conditions are explicit. |
| `completed-retained` | The final PR merged; the packet stays as evidence or precedent.            |
| `superseded`         | Replaced; record `supersededBy` and `supersededNote` in the manifest.      |
| `reference`          | Design or research precedent; not executable unless it has `GOAL.md`.      |

## Completion gate

A goal is achieved only when its final PR merges with required checks green. Local proof is not enough.
Record the PR number in `completionGate.finalPullRequest`, confirm with
`gh pr view <n> --json state,mergedAt,statusCheckRollup`, then set `completed-retained`. Write the reflection
in the same PR.

## Source hierarchy

1. User objective or issue that created the packet.
2. `CLAUDE.md` and required skills.
3. `standards/ARCHITECTURE.md`.
4. The packet's `SPEC.md`, then `PLAN.md`, then `GOAL.md`.
5. Supporting `research/`, `ops/` and `history/` files.

Repo doctrine outranks packet prose when they conflict.

## New packet checklist

1. `cp -R goals/_template goals/<slug>`
2. Replace placeholders in every file.
3. Check the launcher size and the manifest:

```sh
test "$(wc -m < goals/<slug>/GOAL.md)" -le 4000
jq . goals/<slug>/ops/manifest.json
git diff --check -- goals/<slug>
```

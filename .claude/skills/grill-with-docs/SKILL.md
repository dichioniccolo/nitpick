---
name: grill-with-docs
description: Repo-native grilling session for nitpick architecture and product work. Use when stress-testing a plan against standards/ARCHITECTURE.md, the CLAUDE.md code laws, and the slice and driver topology before updating docs or implementation, and when an /explore packet needs the operator.
---

<!-- Adapted from beep-effect (Apache-2.0) .claude/skills/grill-with-docs. Doctrine surfaces repointed to
nitpick's standards/ARCHITECTURE.md and CLAUDE.md. -->

<what-to-do>

Run a `/grilling` session (frontier rounds, recommended answers, subagent fact-finding) over the plan, using
the repo doctrine surfaces below as the domain model: challenge terms, cross-reference code, and update the
owning doc as each decision crystallizes.

If the codebase or the docs can answer a question, explore first instead of asking.

Treat the doctrine as target. If current code disagrees with it, surface the disagreement as drift.

## Escalation path from `/explore`

An `/explore` session comes here when a packet needs the operator (align questions, direction calls, shape
reviews, definition-of-ready gaps); it never stops there. In that mode the packet's `DECISIONS.md` is the
decision surface: log each settled round there (Question, Answer, Rationale) and sync manifest
`openQuestions`. Touch the doctrine docs below only when a round changes repo-wide doctrine. Keep running
rounds and advancing stages until the packet is graduated, parked or killed.

</what-to-do>

<supporting-info>

## Doctrine surfaces

- `standards/ARCHITECTURE.md`: slice and driver topology, package roles, the webhook to worker flow.
- `CLAUDE.md` (symlinked as `AGENTS.md`): code laws, commands, testing and writing rules.
- `.claude/skills/effect-first-development` and `.claude/skills/schema-first-development`: Effect and Schema
  idioms; `.patterns/` holds long-form examples.
- Package `package.json` export maps: boundary subpaths such as `@nitpick/review-server` `./web` and
  `./worker`.
- `migrations/` and each slice `tables` package: persisted shape.

## Grilling posture

Classify the proposal first:

- Product behavior or language: the owning slice (`code-graph`, `review`, `identity`) or a new slice.
- Schemas and pure types: slice `domain` (depends on `effect` only).
- Persisted shape: slice `tables`, then a migration via `bun run db:generate --name <change>`.
- Pure logic: slice `use-cases` (no I/O, no drivers).
- Effect services joining drivers, tables and use-cases: slice `server`.
- One external system (Postgres, GitHub, Claude, tree-sitter, a new one): `packages/drivers/*`.
- Pages, webhook receiver, auth routes: `apps/web`. Queued jobs: `apps/worker`.

Then work the frontier in rounds per `/grilling`. Each question should change the plan, lock an assumption,
or choose between real tradeoffs. Give your recommended answer.

Good first questions usually decide:

- Which slice or driver owns the meaning? Does it need a new package or fit an existing one?
- Does the web bundle stay free of the Claude driver and tree-sitter wasm?
- Does work run in the request path or as a queued job on the Postgres `job` table?
- Does PR content reach a model or GitHub? Then `sanitize`, read-only tools bound to one repository, and
  `.nitpick.json` from the base commit apply.
- Does a dashboard read or write go through `repository_member`, with absent and forbidden both `NotFound`?
- Which typed errors cross which boundary, and which tagged unions model the states?
- Can it be tested with PGlite `layerMigrated` and fake GitHub and Claude services, without module mocks?

## Challenge against doctrine

- `shared`, `common`, `utils`, `lib`: ask which slice owns it, or whether it is a driver.
- `provider` or `client` for an external system: ask whether it is a driver.
- `env`: ask for a typed config through Effect `Config`, not a direct environment read.
- `error`: ask for the tagged error and the boundary where it is translated.
- `async`, `try/catch`, module mock: point at the code law and the allowed exception.

When the user states how something works, check the repo before accepting it: export maps, package manifests,
imports, existing tests. If code contradicts doctrine, say so and classify it: drift, cleanup-on-touch, or a
doctrine gap that needs a decision.

## Update docs inline

Update only the surface that owns the decision:

- Topology, package roles or flow: `standards/ARCHITECTURE.md`.
- A code law, command or testing rule: `CLAUDE.md`.
- Packet-local calls: the packet `DECISIONS.md`.

Do not create ADR directories or glossary files. Propose a repo-wide doctrine edit only when it changes or
supersedes doctrine, is hard to reverse, and resolves a real tradeoff.

</supporting-info>

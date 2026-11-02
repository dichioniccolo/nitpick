---
name: explore
description: >
  Drive an exploration packet through the fuzzy front end: capture, research,
  align, shape, decompose, graduate into goals/ packets. Trigger on:
  `/explore`, a new fuzzy idea or brainstorm to capture, "crystallize this",
  "help me break down this vision", decomposing a vision into goal packets,
  triaging explorations/INBOX.md, or resuming any packet under explorations/.
metadata:
  version: "0.3.0-nitpick"
  status: active
---

<!-- Adapted from beep-effect (Apache-2.0) .claude/skills/explore @ v0.3.0. Local changes: no `beep` CLI,
so the manifest is the only state authority and the Atlas projection is dropped; in-repo inventory points at
nitpick's slices and drivers. -->

# Explore

Operate the `explorations/` pipeline defined in
[`explorations/README.md`](../../../explorations/README.md). Read that file once per session before acting:
it owns stages, statuses, the manifest schema and the graduation contract. This skill is the operating
procedure, not a copy of the convention.

## Invocation forms

- `/explore`: orient. Triage `explorations/INBOX.md` if it has bullets, then list active packets with stage
  and next open question (read each `explorations/*/ops/manifest.json`), and recommend what to pick up.
- `/explore new <topic>`: copy `explorations/_template/` to `explorations/<slug>/` (kebab-case slug, real
  dates, title from topic), fill the manifest and README placeholders, then drop into capture intake.
- `/explore <slug> [stage]`: read `explorations/<slug>/ops/manifest.json` and resume at its `stage`, or at
  the stage given.

## Session protocol

1. Read the packet manifest, then the packet `README.md`, then only the artifacts the current stage needs.
2. Work the stage per the table below.
3. **Operator needed means `/grill-with-docs`, never a stop.** When the packet needs the operator (align
   questions, a direction call, a shape review, a definition-of-ready gap), do not end with a prose summary.
   Load the `grill-with-docs` skill and run its workflow: frontier rounds via AskUserQuestion, recommended
   answer first, each settled answer logged in the packet `DECISIONS.md`. Keep driving align, shape,
   decompose and graduate until the packet is graduated, parked or killed. Only that terminal state gets a
   closeout summary.
4. **Close the loop before ending**: update the manifest (`stage`, `status`, `openQuestions`, `updated`),
   mirror `stage` and `status` into the README Status block, rewrite the README "Next open question", append
   a dated Trail line, and check the manifest parses with `jq . explorations/<slug>/ops/manifest.json`.
   Cold-session resume depends on this.

## Stage behavior

**capture**: frictionless intake. File whatever the user dumps into `CAPTURE.md` under a dated heading
(media into `assets/`, referenced relatively). Never interrogate, never reorganize, never summarize back.
Advance to research only when the user signals the dump is done.

**research**: ground the idea two ways, then write `RESEARCH.md` with dated sections. (a) External landscape
via web search and fetch, every claim cited. (b) In-repo capability inventory via targeted searches over
`packages/*/*/src/**`, `packages/drivers/*/src/**`, `apps/*/src/**`, package `index.ts` barrels and
`standards/ARCHITECTURE.md`, citing package and path, marking gaps NOT FOUND. Surface constraints found,
including the code laws in `CLAUDE.md` (hostile PR content, read-only agent tools, `repository_member`
gating). Fan out subagents for breadth when the topic is wide. Keep `research/SOURCES.md` as the provenance
ledger: every external citation with its on-disk URL, each upstream repo and its license (copyleft means
clean-room only; permissive means port with attribution in `NOTICE.md`; missing or unverified means
reference only), each mined source (id, repo, `file:line`, disposition), and each in-repo brick the packet
composes. Never fabricate a URL; cite the RESEARCH.md section when none exists on disk.

**align**: run the `grill-with-docs` workflow over the decision tree. Work the frontier in rounds (every
currently unblocked question per round, via AskUserQuestion, recommended answer first with reasoning).
Explore the codebase instead of asking when the repo can answer. After each settled round, append dated
entries to `DECISIONS.md` (Question, Answer, Rationale, rejected options included) and sync manifest
`openQuestions` to the remaining frontier. Deferred questions are logged DEFERRED with a reason, never
dropped. When a round closes, start the next or move to shape in the same session.

**shape**: draft `BRIEF.md` (problem, appetite, solution sketch, rabbit holes, no-gos) from capture,
research and decisions, at fat-marker fidelity: concrete enough to decompose, rough enough to leave design
latitude. Each review loop is a `grill-with-docs` round (recommended revision first), not a hand-back. Exit
only when the user confirms it matches the picture in their head. Log shape calls in `DECISIONS.md`.

**decompose**: build `MAP.md`: candidate goal packets (slug, mission, dependencies), sequencing with
rationale, the first vertical slice, inherited risks. Run the capability check: every major component cites
an existing slice, driver or app module, or is marked NET-NEW. Challenge any NET-NEW that smells like an
existing brick. Name the owning slice per `standards/ARCHITECTURE.md`, and flag any candidate that needs a
migration (`bun run db:generate`) or touches a page (`bun run e2e`).

**graduate**: check the four-point definition of ready in `explorations/README.md`. If a point fails, name it
and drop back to the owning stage, grilling the operator when only they can close it. Then, per approved
candidate: copy `goals/_template/` to `goals/<slug>/` per `goals/README.md`, `GOAL.md` launcher included.
Seed `SPEC.md` from the brief (no-gos become non-goals, rabbit holes become constraints, `DECISIONS.md`
entries seed the decision log) with back-links to the exploration, not copies. Cross-link both manifests
(`links.goals` here, `provenance.exploration` there). Copy the exploration's `research/SOURCES.md` into
`goals/<slug>/research/SOURCES.md`, linking the exploration ledger as primary, and register it in the goal
manifest `researchReports[]` and `currentSourceOfTruth[]`. Flip the exploration status to `graduated` once
every promised-now goal exists. Gated or queued candidates do not hold the packet open: they stay in `MAP.md`
as re-entry points, and a fired gate reopens the packet at `decompose`.

## Guardrails

- Parking and killing are first-class outcomes. Park with a dated reason in `DECISIONS.md`; kill with a
  one-line epitaph in `DECISIONS.md` or the README Trail. Offer them when momentum or conviction dies; never
  let a packet rot as fake `active`.
- Ask in frontier rounds per `/grilling`: batch every currently unblocked question, never one whose
  prerequisite is still open this round.
- Needing the operator is never a stopping point. Switch into `grill-with-docs` and keep going until the
  packet is graduated, parked or killed, or the operator chooses a hold in a grill round.
- `CAPTURE.md` is append-only; never tidy it.
- Provenance is load-bearing: keep `research/SOURCES.md` current from research on, never fabricate a source,
  URL or license, and treat a missing upstream license as reference only.
- Explorations are not doctrine. Architecture changes land in `standards/ARCHITECTURE.md` or `CLAUDE.md`;
  implementation contracts land in a goal packet.
- Stage loops are normal (align exposes a research gap, do the research, return). Record the loop in the
  README Trail.
- Packets are docs. Commit them on a branch like any other change, since a push to `main` deploys.

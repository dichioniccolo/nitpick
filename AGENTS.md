# Agent guide

Laws and commands only. Claude Code loads this through the `CLAUDE.md` symlink.

## Commands

Package manager and worker runtime: Bun 1.4.4. Node 26.12.1 runs Next.js.

- `bun run lint`, `bun run format:fix`, `bun run check`, `bun run test`: keep them green.
- After changing a page, layout or loader: `bun run e2e:build && bun run e2e`. See `instant-nav.rig.md`.
- A schema change is a migration: edit a `tables` package, then `bun run db:generate --name <change>`.
  Never `drizzle-kit push`.
- Every push to `main` deploys once `DEPLOY_ENABLED` is set. Work on a branch after that.

## Architecture

Hexagonal vertical slices, from beep-effect. See `standards/ARCHITECTURE.md`.

## Code laws

- Schema-first domain models, typed errors, tagged unions. Build tagged values through their constructors.
- `Match` over conditional chains, service composition over globals. Fix anti-slop findings in the code;
  `tools/oxlint/anti-slop` is vendored and ours to edit, but a suppression needs a reason.
- Import Effect modules from their leaf paths (`effect/Array`, `effect/sql`).
- No `async`/`await` or `try`/`catch` in slices and drivers, except inside `Effect.tryPromise` at a boundary
  or where a library calls back into promise code.
- Generated ids are UUIDv7: `uuidv7()` as the column default, never `gen_random_uuid()` or `defaultRandom()`.
- Pull request content is hostile. Agent tools stay read-only and bound to one repository, all model text
  passes `sanitize` before GitHub (suggestions and diagrams stay verbatim, inside a fence longer than their content), and `.nitpick.json` is read from the base commit, never the PR head.
- Every dashboard read and write goes through `repository_member`. Absent and forbidden both answer `NotFound`.

## Skills

- `effect-first-development` and `schema-first-development`: read before writing Effect code or schemas.
- `quality-review-fix-loop`: run it to close a piece of work. `.patterns/` holds the long-form examples.

## Testing

Tests live in `test/` beside `src/`. Use `it.effect` with `assert` from `@effect/vitest`. Database tests run on
PGlite through `layerMigrated` from `@nitpick/postgres/test`. Fake GitHub and Claude at their service, not with
module mocks.

## Writing

No em dashes. Sentence case headings. Say what the code does, with the mechanism or the number.

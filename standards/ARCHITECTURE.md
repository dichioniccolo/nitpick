# Architecture

Adapted from the beep-effect architecture standard (Apache-2.0): a hexagonal vertical slice per
domain, with technical wrappers in a separate `drivers` family.

| Package                      | Role                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| `packages/<slice>/domain`    | Schemas and pure types. Depends on `effect` only.                |
| `packages/<slice>/tables`    | Drizzle tables. `drizzle.config.ts` globs `*.table.ts`.          |
| `packages/<slice>/use-cases` | Pure logic: no I/O, no drivers.                                  |
| `packages/<slice>/server`    | Effect services that join drivers, tables and use-cases.         |
| `packages/drivers/*`         | One external system each: Postgres, GitHub, Claude, tree-sitter. |
| `apps/web`                   | Next.js: pages, webhook receiver, better-auth routes.            |
| `apps/worker`                | Bun: runs queued jobs.                                           |

Slices: `code-graph` (index and search), `review` (queue, agent, publishing, dashboard), `identity`
(better-auth and repository membership).

`@nitpick/review-server` exports `./web` and `./worker` apart, so the Next bundle never pulls in
the Claude driver or the tree-sitter wasm.

## Flow

1. GitHub posts to `/api/github/webhook`. The route checks the HMAC, then records the delivery id and
   queues jobs in one transaction, so a redelivery does nothing.
2. The worker claims from the Postgres `job` table with `FOR UPDATE SKIP LOCKED`. A heartbeat renews a
   3 minute lease, so a dead worker's job returns to the queue. Three attempts with backoff.
3. Indexing downloads the tarball, skips unchanged files by hash, and stores files, symbols and references.
4. A review runs four specialist agents in parallel (logic, security, architecture, tests), each a
   loop with read-only tools over that graph and over files at the PR's head and base commits. Each
   ends with `submit_findings`. Their findings merge by fingerprint, then a verifier agent with the
   same tools ends with `submit_review`: a verdict per candidate, which may only lower a severity,
   and the summary. Schemas decode every finish input; an unconfirmed candidate is never posted.
5. `selectFindings` keeps what sits on diff lines, clears the strictness floor and is new on this PR.
6. Reactions are polled every 30 minutes, as GitHub has no webhook for them, and become learnings
   in the next review's prompt.

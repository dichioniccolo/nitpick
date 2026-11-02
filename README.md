# Nitpick

AI review for GitHub pull requests, on your own cluster. It indexes each repository into a code graph,
then reviews a PR by following the change into its callers and dependencies. Findings land as inline
comments, with a summary, a confidence score and a sequence diagram.

It reproduces the behavior of hosted reviewers such as Greptile. It shares no code or branding with them.

## What it does

- Reviews a PR when it opens, or on `@<app-slug> review`. Set `triggerOnUpdates` to review each push.
- Reviews PRs only from owners, members and collaborators, and answers mentions only from them, so a
  stranger cannot spend your API budget.
- Learns from thumbs up and down on its comments, counting only users with write access, and from
  team rules in the dashboard.
- Posts a `nitpick` check on each head: `failure` when a finding reaches `checks.failOn` (default
  `critical`), `neutral` when the review itself fails, `skipped` when a skip rule applies (draft, label,
  author, base branch), and the last result again on a push it does not review. Re-run on the check
  reviews that head; `checks.enabled: false` turns it off. Require it in branch protection to gate merges.
- Writes one summary comment per PR in Greptile's layout: confidence score, an impact-tagged verdict,
  a summary with bullets, the sequence diagram, and View in Nitpick and Retrigger buttons. Retrigger
  opens a confirm page in the dashboard, open to repository members only.
- Reads `.nitpick.json` from the base commit, so a PR cannot weaken its own review. See
  `.nitpick.example.json`.

Claude does the reviewing (`claude-opus-5-5`, effort `high`), so each review costs API credits. The
dashboard shows no spend yet, but tokens are stored on each `review` row.

Not built: replies inside inline comment threads, per-push incremental diffs, usage limits, and analysis
for languages beyond TypeScript, JavaScript, Python, Go, Rust and Java. Other files are still text-searchable.

## Stack

Taken from beep-effect: Bun workspaces, Turborepo, Effect v4, Drizzle over `@effect/sql-pg`, TypeScript 7,
Vitest with `@effect/vitest`, lefthook, commitlint, changesets, syncpack, gitleaks, typos, and hexagonal
vertical slices. Linting is oxlint with [anti-slop](https://github.com/dmmulroy/anti-slop) and formatting
is oxfmt. Sign-in is better-auth. Node 26.12.1 runs Next.js 16.

See `standards/ARCHITECTURE.md` for the flow and `instant-nav.rig.md` for the page rules.

## GitHub App

Create one at `https://github.com/settings/apps/new`.

- Webhook: active, URL `<APP_URL>/api/github/webhook`, with a secret.
- Callback URL: `<APP_URL>/api/auth/callback/github`.
- Repository permissions: Contents read, Metadata read, Pull requests read and write, Issues read and write,
  Checks read and write.
- Account permissions: Email addresses read (optional).
- Events: Pull request, Push, Issue comment, Check run. Every App also receives `installation` and
  `installation_repositories` by default; they are not selectable.
- Existing App: add Checks read and write and the Check run event in its settings, then accept the new
  permission on each installation. Until then nitpick logs `check run write failed` with status 403 and
  posts no check; reviews still run.

## Local development

```sh
cp .env.example .env   # fill it in; Postgres must be version 18 for uuidv7()
bun install
bun run db:migrate
bun run dev
```

## Deploy

`deploy/README.md` lists the one-time cluster steps. After those, CI deploys `main`.

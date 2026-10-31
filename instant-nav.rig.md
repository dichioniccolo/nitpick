# Instant-nav rig

Every page commits a static shell at once; data streams into it. `e2e/instant-nav.spec.ts` proves
it with Playwright's `instant()`, which holds every dynamic read: a route passes only when its
shell commits alone.

## Rules for pages

- Pages and layouts are plain functions that await nothing, and read no `params`, `searchParams`,
  `headers()` or session outside a `<Suspense>`.
- Request data lives in a small async component inside a `<Suspense>` with a skeleton. Never put
  `loading.tsx` above a layout.
- `requireUser` settles `headers()` before any Effect runs: a fiber reads the clock when it starts,
  which Cache Components rejects during a prerender.
- A new page gets a `data-testid="<page>-shell"` on a shell node, never on data, and a test that
  asserts its data has count 0 under `instant()` and is visible after, so the lock is proven to hold.

## Walls

- `notFound()` fires inside a `<Suspense>`, after the static shell has flushed with status 200. A
  missing or forbidden page therefore answers 200 and renders "Nothing here", never a 404 status.
  Both answers are the same, which is what tenancy needs. Do not move the read above the boundary
  to get a 404: the shell would stop being instant. The guard pins this for `/app/repos/x/y`.

## Run it

```sh
export DATABASE_URL=postgres://... APP_URL=https://nitpick.test AUTH_SECRET=... \
  GITHUB_APP_SLUG=x GITHUB_CLIENT_ID=x GITHUB_CLIENT_SECRET=x
bun run e2e:build   # next build with EXPOSE_TESTING_API=1
bun run e2e         # migrates, seeds, signs in, starts next start, runs desktop and mobile
```

- Never measure `next dev`: it does not prefetch, so no dev result counts.
- A stale server on port 3000 reads as a false green. Stop it first.
- `APP_URL` must be https. With http, better-auth names the cookie without `__Secure-`, the seeded
  session is ignored, and signed-in tests land on the landing page.
- `EXPOSE_TESTING_API` belongs to the CI job and your shell, never to the Dockerfile or chart. The
  suite's first test fails if a build lacks the API, so nothing passes vacuously.

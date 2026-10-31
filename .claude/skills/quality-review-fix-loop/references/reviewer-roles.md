# Reviewer Roles

Read-only reviewer/critic panel for the quality-review-fix loop (Phase 2).
Each reviewer receives the initiative summary, base commit, changed-surface
list, source-of-truth list, and the inventory item format from
`templates.md`.

## Reviewer Contract

Every reviewer must:

- stay read-only
- cite source standards and concrete file/command evidence
- classify each finding as `blocking`, `non-blocking`, `question`, or `note`
- distinguish changed-scope blockers from historical repo debt
- include suggested fixes and acceptance commands
- return `0 required findings` when no blockers remain

## Roles

1. Quality Gate Reviewer
   - Checks the quality commands, failed lanes, warnings, generated migrations,
     package metadata and chart lint.

2. Architecture Boundary Reviewer
   - Checks package home and dependency direction per `standards/ARCHITECTURE.md`:
     domain and use-cases stay free of drivers, and `@nitpick/review-server/web`
     never pulls in the Claude driver or tree-sitter.

3. Schema And Domain Reviewer
   - Checks schema-first models, same-name schema and type exports, tagged
     constructors, defaults and decoding at every external boundary.
   - Suggested skill: `schema-first-development`.

4. Effect Law Reviewer
   - Checks import aliases, typed errors, `Effect.fn`, `Context.Service`, `Layer`,
     `Config`, `Redacted`, resource handling, retries, timeouts and concurrency.
   - Suggested skill: `effect-first-development`.

5. Error Boundary Reviewer
   - Checks driver errors stay in adapters, `NotFound` hides absent versus
     forbidden, and dropped technical detail is logged where it is translated.

6. Testing Reviewer
   - Checks `@effect/vitest`, fakes at the service seam with no module mocks,
     PGlite for database tests, and a test that can fail for each new behavior.

7. Observability Reviewer
   - Checks spans at boundaries named `<slice>.<concept>.<action>`, low-cardinality
     attributes, and no secrets, tokens or source code in logs.

8. Documentation And API Reviewer
   - Checks that README, `deploy/README.md`, chart comments and `AGENTS.md` match
     the behavior, and that the "Not built" list is still true.

9. Reuse And Duplication Reviewer
   - Checks duplication and missed existing modules. Rejects vague `common`,
     `core`, `utils` or `lib` packages.

10. Security And Tenancy Reviewer
    - Treats PR content as hostile. Checks agent tools stay read-only and bound to
      one repository, model text passes `sanitize`, `.nitpick.json` comes from the
      base commit, webhooks verify their HMAC, trust checks gate API spend, and
      every dashboard path goes through `repository_member`.

11. Instant Navigation Reviewer
    - Checks pages and layouts await nothing outside `<Suspense>`, each new page
      has a shell marker and a guard test, and `EXPOSE_TESTING_API` stays out of
      the Dockerfile and chart.

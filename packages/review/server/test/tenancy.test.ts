import { assert, describe, layer } from "@effect/vitest";
import { installation, repository } from "@nitpick/code-graph-tables";
import { replaceMembership } from "@nitpick/identity-server";
import { user } from "@nitpick/identity-tables";
import { Database } from "@nitpick/postgres";
import { layerMigrated, repositoryMigrations } from "@nitpick/postgres/test";
import { ReviewPullRequest } from "@nitpick/review-domain";
import { job, review, rule } from "@nitpick/review-tables";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Dashboard, NotFound, Queue } from "../src/web.ts";

const Live = Dashboard.layer.pipe(
  Layer.provideMerge(Queue.layer),
  Layer.provideMerge(Database.layer),
  Layer.provideMerge(layerMigrated(repositoryMigrations)),
);

const someone = "01960000-0000-7000-8000-00000000000a";

const denied = <A>(attempt: Effect.Effect<A, NotFound>) =>
  Effect.map(Effect.flip(attempt), (error) => assert.instanceOf(error, NotFound));

describe("tenant isolation", () => {
  layer(Live)((it) => {
    it.effect("only members reach a repository, and absent reads the same as forbidden", () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const dashboard = yield* Dashboard;
        yield* db
          .insert(installation)
          .values({ id: 1, accountLogin: "acme", accountType: "Organization" });
        yield* db.insert(repository).values([
          { id: 10, installationId: 1, fullName: "acme/one", defaultBranch: "main", private: true },
          { id: 20, installationId: 1, fullName: "acme/two", defaultBranch: "main", private: true },
        ]);

        const [alice, bob] = yield* db
          .insert(user)
          .values([
            { name: "a", email: "a@x" },
            { name: "b", email: "b@x" },
          ])
          .returning();

        if (alice === undefined || bob === undefined) throw new Error("expected users");
        assert.match(alice.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/);

        yield* replaceMembership(alice.id, [10, 999]);
        yield* replaceMembership(bob.id, [20]);

        assert.deepStrictEqual(
          (yield* dashboard.repositories(alice.id)).map((row) => row.fullName),
          ["acme/one"],
        );

        const [secret] = yield* db
          .insert(review)
          .values({
            repositoryId: 20,
            prNumber: 1,
            prTitle: "t",
            prAuthor: "b",
            headSha: "h",
            baseSha: "b",
          })
          .returning();

        const [bobRule] = yield* db
          .insert(rule)
          .values({ repositoryId: 20, text: "r", createdByLogin: "b" })
          .returning();

        if (secret === undefined || bobRule === undefined) throw new Error("expected rows");

        assert.lengthOf(yield* dashboard.recentReviews(alice.id, null), 0);
        assert.lengthOf(yield* dashboard.recentReviews(alice.id, 20), 0);

        yield* denied(dashboard.repository(alice.id, "acme/two"));
        yield* denied(dashboard.repository(alice.id, "nobody/none"));
        yield* denied(dashboard.review(alice.id, secret.id));
        yield* denied(dashboard.rules(alice.id, 20));
        yield* denied(dashboard.reindex(alice.id, 20));
        yield* denied(dashboard.addRule({ id: alice.id, login: "a" }, 20, "x"));
        yield* denied(dashboard.setRepositoryEnabled(alice.id, 20, false));
        yield* denied(dashboard.setRuleEnabled(alice.id, bobRule.id, false));
        yield* denied(dashboard.deleteRule(alice.id, bobRule.id));

        const [kept] = yield* db.select().from(rule).where(eq(rule.id, bobRule.id));
        assert.isTrue(kept?.enabled);

        // Losing access on GitHub removes it at the next sign-in.
        yield* replaceMembership(alice.id, []);
        assert.lengthOf(yield* dashboard.repositories(alice.id), 0);
      }),
    );

    it.effect("a malformed review id answers NotFound, not a Postgres error", () =>
      Effect.gen(function* () {
        const dashboard = yield* Dashboard;
        yield* denied(dashboard.review(someone, "abc"));
        yield* denied(dashboard.review(someone, ""));
      }),
    );

    it.effect("a malformed rule id answers NotFound, not a Postgres error", () =>
      Effect.gen(function* () {
        const dashboard = yield* Dashboard;
        yield* denied(dashboard.setRuleEnabled(someone, "abc", false));
        yield* denied(dashboard.deleteRule(someone, "abc"));
      }),
    );

    it.effect("a repository id that is not a bigint answers NotFound", () =>
      Effect.forEach([Number.NaN, Number.POSITIVE_INFINITY, 1e20, 1.5], (id) =>
        Effect.gen(function* () {
          const dashboard = yield* Dashboard;
          yield* denied(dashboard.rules(someone, id));
          yield* denied(dashboard.learnings(someone, id));
          yield* denied(dashboard.addRule({ id: someone, login: "a" }, id, "x"));
          yield* denied(dashboard.setRepositoryEnabled(someone, id, false));
          yield* denied(dashboard.reindex(someone, id));
        }),
      ),
    );

    it.effect("a repository name with a NUL answers NotFound", () =>
      Effect.gen(function* () {
        const dashboard = yield* Dashboard;
        yield* denied(dashboard.repository(someone, "acme/\u0000"));
      }),
    );

    it.effect("only a member can retrigger a review, and it queues a requested one", () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const dashboard = yield* Dashboard;
        yield* db
          .insert(installation)
          .values({ id: 3, accountLogin: "beta", accountType: "Organization" })
          .onConflictDoNothing();
        yield* db
          .insert(repository)
          .values({
            id: 30,
            installationId: 3,
            fullName: "beta/app",
            defaultBranch: "main",
            private: true,
          })
          .onConflictDoNothing();

        const [member, stranger] = yield* db
          .insert(user)
          .values([
            { name: "m", email: "m@x" },
            { name: "s", email: "s@x" },
          ])
          .returning();

        if (member === undefined || stranger === undefined) throw new Error("expected users");
        yield* replaceMembership(member.id, [30]);

        const [row] = yield* db
          .insert(review)
          .values({
            repositoryId: 30,
            prNumber: 4,
            prTitle: "t",
            prAuthor: "dev",
            headSha: "h",
            baseSha: "b",
          })
          .returning();

        if (row === undefined) throw new Error("expected a review");
        yield* db.delete(job);

        yield* denied(dashboard.retrigger(stranger.id, row.id));
        yield* denied(dashboard.retrigger(member.id, "not-a-uuid"));
        yield* denied(dashboard.retrigger(member.id, someone));
        assert.lengthOf(yield* db.select().from(job), 0);

        yield* dashboard.retrigger(member.id, row.id);
        const [queued] = yield* db.select().from(job);
        assert.deepStrictEqual(
          queued?.payload,
          ReviewPullRequest.make({
            repositoryId: 30,
            prNumber: 4,
            headSha: "",
            trigger: "requested",
          }),
        );
      }),
    );
  });
});

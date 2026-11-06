import { readFileSync } from "node:fs";
import { assert, describe, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { SqlClient } from "effect/sql";

import { layerMigrated, repositoryMigrations } from "../src/test.ts";

/** The data half of the P0-P3 migration: its UPDATE statements, run again over legacy rows. */
const rewrites = readFileSync(
  `${repositoryMigrations}/20261106180944_review_verified_findings/migration.sql`,
  "utf8",
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => /^(--[^\n]*\n)*UPDATE/i.test(statement));

describe("severity migration", () => {
  layer(layerMigrated(repositoryMigrations))((it) => {
    it.effect("maps critical, major and minor to P0-P2 in rows and in repeated", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.lengthOf(rewrites, 2);

        yield* sql`insert into installation (id, "accountLogin", "accountType") values (1, 'acme', 'Organization')`;
        yield* sql`insert into repository (id, "installationId", "fullName", "defaultBranch", private) values (1, 1, 'acme/api', 'main', true)`;
        yield* sql`insert into review (id, "repositoryId", "prNumber", "prTitle", "prAuthor", "headSha", "baseSha", repeated) values
          ('00000000-0000-7000-8000-000000000001', 1, 1, 't', 'a', 'h1', 'b', '[{"fingerprint":"x","severity":"critical"},{"fingerprint":"y","severity":"minor"}]'),
          ('00000000-0000-7000-8000-000000000002', 1, 2, 't', 'a', 'h2', 'b', null),
          ('00000000-0000-7000-8000-000000000003', 1, 3, 't', 'a', 'h3', 'b', '{}'),
          ('00000000-0000-7000-8000-000000000004', 1, 4, 't', 'a', 'h4', 'b', '[]')`;
        yield* sql`insert into finding ("reviewId", "repositoryId", "prNumber", path, line, severity, category, title, body, fingerprint) values
          ('00000000-0000-7000-8000-000000000001', 1, 1, 'p', 1, 'critical', 'logic', 't', 'b', 'f1'),
          ('00000000-0000-7000-8000-000000000001', 1, 1, 'p', 1, 'major', 'logic', 't', 'b', 'f2'),
          ('00000000-0000-7000-8000-000000000001', 1, 1, 'p', 1, 'minor', 'logic', 't', 'b', 'f3'),
          ('00000000-0000-7000-8000-000000000001', 1, 1, 'p', 1, 'P3', 'logic', 't', 'b', 'f4')`;

        for (const statement of rewrites) yield* sql.unsafe(statement);

        const findings = yield* sql<{
          severity: string;
        }>`select severity from finding order by fingerprint`;

        assert.deepStrictEqual(
          findings.map((row) => row.severity),
          ["P0", "P1", "P2", "P3"],
        );

        const reviews = yield* sql<{
          repeated: unknown;
        }>`select repeated from review order by "prNumber"`;

        assert.deepStrictEqual(
          reviews.map((row) => row.repeated),
          [
            [
              { fingerprint: "x", severity: "P0" },
              { fingerprint: "y", severity: "P2" },
            ],
            null,
            {},
            [],
          ],
        );
      }),
    );
  });
});

import { assert, describe, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { SqlClient } from "effect/sql";

import { layerMigrated, repositoryMigrations } from "../src/test.ts";

describe("migrations", () => {
  layer(layerMigrated(repositoryMigrations))((it) => {
    it.effect("build the schema on a fresh database", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const rows =
          yield* sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;

        assert.strictEqual(rows[0]?.n, 16);
      }),
    );
  });
});

import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgliteClient from "@effect/sql-pglite/PgliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { fileURLToPath } from "node:url";

import * as PostgresDrizzle from "../PostgresDrizzle";

/**
 * An in-memory Postgres (PGlite) standing in for the `PgClient`, for tests.
 * Each build of the layer is a fresh, empty database.
 */
export const layerTest = Layer.effect(
  PgClient.PgClient,
  Effect.map(
    Effect.service(PgliteClient.PgliteClient),
    (client) =>
      // SAFETY: Drizzle's effect-postgres session resolves the `PgClient` tag
      // but calls only `SqlClient` members (`unsafe`, `withTransaction`),
      // which `PgliteClient` implements with the same semantics. The two
      // types share no declared supertype, so the cast goes through
      // `unknown`. A Drizzle upgrade that calls a pg-only member fails here.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions
      client as unknown as PgClient.PgClient,
  ),
).pipe(Layer.provideMerge(PgliteClient.layer({})));

/**
 * The repository's migrations folder (`out` in `drizzle.config.ts`), which
 * builds every test schema.
 */
export const repositoryMigrations = fileURLToPath(
  new URL("../../../../../migrations", import.meta.url),
);

/**
 * `layerTest` with the migrations in `migrationsFolder` applied, so tests
 * run on the schema production has.
 */
export const layerMigrated = (migrationsFolder: string) =>
  Layer.effectDiscard(Effect.orDie(PostgresDrizzle.migrate(migrationsFolder))).pipe(
    Layer.provideMerge(layerTest),
  );

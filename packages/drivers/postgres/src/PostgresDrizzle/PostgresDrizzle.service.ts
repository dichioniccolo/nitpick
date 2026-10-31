import type { PgClient } from "@effect/sql-pg/PgClient";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { migrate as runMigrations } from "drizzle-orm/effect-postgres/migrator";
import * as Effect from "effect/Effect";

/**
 * A Drizzle database whose queries are Effects run on the current
 * `PgClient`, so they share its pool, its transactions and its `sql.execute`
 * spans.
 */
export type Database<TRelations extends AnyRelations = EmptyRelations> =
  EffectPgDatabase<TRelations> & { readonly $client: PgClient };

/**
 * Build a Drizzle database over the `PgClient` in context, with Drizzle's
 * no-op logger and cache. A slice wraps the result in its own service, typed
 * by the relations of its `tables` package.
 *
 * @example
 * ```ts
 * import * as Context from "effect/Context"
 * import * as Layer from "effect/Layer"
 * import { PostgresDrizzle } from "@nitpick/postgres"
 *
 * class Db extends Context.Service<Db, PostgresDrizzle.Database>()("Db") {}
 *
 * const DbLayer = Layer.effect(Db, PostgresDrizzle.make())
 * ```
 */
export const make: <TRelations extends AnyRelations = EmptyRelations>(
  config?: Parameters<typeof PgDrizzle.makeWithDefaults<TRelations>>[0],
) => Effect.Effect<Database<TRelations>, never, PgClient> = PgDrizzle.makeWithDefaults;

/**
 * Apply the pending migrations in `migrationsFolder` to the `PgClient`'s
 * database, recording them in `drizzle.__drizzle_migrations` as
 * `drizzle-kit migrate` does.
 */
export const migrate = (migrationsFolder: string) =>
  Effect.flatMap(make(), (db) => runMigrations(db, { migrationsFolder }));

import * as PgClient from "@effect/sql-pg/PgClient";

import { DatabaseSsl, DatabaseUrl } from "./Postgres.config";

/**
 * A pooled `PgClient` (and its `SqlClient`) over `DATABASE_URL`.
 * TLS follows the URL's `sslmode` as libpq reads it (see `sslOf`). A
 * missing URL fails the layer, so the app entrypoint reports it when the
 * runtime builds.
 */
export const layer = PgClient.layerConfig({
  url: DatabaseUrl,
  ssl: DatabaseSsl,
});

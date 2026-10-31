import type { ConnectionOptions } from "node:tls";
import * as Config from "effect/Config";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

/**
 * The application database, `DATABASE_URL`. Its schema comes from
 * the migrations in the root `migrations/` folder.
 */
export const DatabaseUrl = Config.Redacted("DATABASE_URL");

/**
 * The TLS settings `url`'s `sslmode` asks for, read as libpq reads them.
 * `require` encrypts without checking the server's certificate, which
 * `PgClient` would check: CloudNativePG signs with its own CA, which the
 * app does not hold. Every other mode, and a URL without one, is left to
 * `PgClient`, so `verify-ca` and `verify-full` still check.
 */
export const sslOf = (url: Redacted.Redacted): ConnectionOptions | undefined =>
  Option.fromNullishOr(URL.parse(Redacted.value(url))).pipe(
    Option.filter((parsed) => parsed.searchParams.get("sslmode") === "require"),
    Option.as({ rejectUnauthorized: false }),
    Option.getOrUndefined,
  );

/** The TLS settings of `DATABASE_URL`, by `sslOf`. */
export const DatabaseSsl = Config.map(DatabaseUrl, sslOf);

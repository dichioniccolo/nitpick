import { BunRuntime } from "@effect/platform-bun";
import { Postgres, PostgresDrizzle } from "@nitpick/postgres";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

// The Helm pre-upgrade hook runs this; MIGRATIONS_DIR points at the image's copy.
const program = Effect.gen(function* () {
  const folder = yield* Config.String("MIGRATIONS_DIR").pipe(Config.withDefault("./migrations"));
  yield* PostgresDrizzle.migrate(folder);
  yield* Effect.logInfo("migrations applied", folder);
});

BunRuntime.runMain(program.pipe(Effect.provide(Postgres.layer)));

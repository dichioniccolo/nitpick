import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import * as PostgresDrizzle from "./PostgresDrizzle";

/** The Drizzle database every slice queries through. */
export class Database extends Context.Service<Database, PostgresDrizzle.Database>()(
  "@nitpick/postgres/Database",
) {
  static readonly layer = Layer.effect(Database, PostgresDrizzle.make());
}

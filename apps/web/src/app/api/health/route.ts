import * as Effect from "effect/Effect";
import { SqlClient } from "effect/sql";
import { connection } from "next/server";

import { AppRuntime } from "@/server/runtime";

const databaseReady = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`select 1`;
}).pipe(
  Effect.timeout("2 seconds"),
  Effect.as(true),
  Effect.orElseSucceed(() => false),
);

export const GET = async (): Promise<Response> => {
  await connection();
  const db = await AppRuntime.runPromise(databaseReady);

  return Response.json(
    { ok: db, db },
    { status: db ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
};

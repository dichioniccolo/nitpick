import { Identity } from "@nitpick/identity-server";
import * as Effect from "effect/Effect";

import { AppRuntime } from "@/server/runtime";

const handle = (request: Request): Promise<Response> =>
  AppRuntime.runPromise(
    Effect.flatMap(Effect.service(Identity), (identity) =>
      Effect.promise(() => identity.handler(request)),
    ),
  );

export const GET = handle;
export const POST = handle;

import "server-only";
import { cache } from "react";
import { Identity, type User } from "@nitpick/identity-server";
import { Dashboard, type NotFound } from "@nitpick/review-server/web";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppRuntime } from "./runtime";

/**
 * The signed-in user, or a redirect to the landing page. `headers()` settles
 * first: during `next build` it never does, so the shell renders around the
 * pending read and the runtime, which needs the environment, is never built.
 * Effect fibers read the clock when they start, which Cache Components rejects
 * in a prerender. Cached per request, as several slots share it.
 */
export const requireUser = cache(async (): Promise<User> => {
  const requestHeaders = await headers();

  const user = await AppRuntime.runPromise(
    Effect.flatMap(Effect.service(Identity), (identity) => identity.userOf(requestHeaders)),
  );

  if (user === null) redirect("/?signin=required");

  return user;
});

/**
 * Run a dashboard call as the signed-in user, turning `NotFound` into Next's not-found page.
 * Every page caller sits inside a `<Suspense>`, so the shell has already flushed with status 200 and
 * the page answers 200 with "Nothing here", never a 404 status. See instant-nav.rig.md.
 */
export const dashboard = async <A>(
  use: (service: typeof Dashboard.Service, user: User) => Effect.Effect<A, NotFound>,
): Promise<A> => {
  const user = await requireUser();

  const result = await AppRuntime.runPromise(
    Effect.result(Effect.flatMap(Effect.service(Dashboard), (service) => use(service, user))),
  );

  if (Result.isFailure(result)) notFound();

  return result.success;
};

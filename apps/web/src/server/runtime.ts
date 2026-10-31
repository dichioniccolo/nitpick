import "server-only";
import { Identity } from "@nitpick/identity-server";
import { Database, Postgres } from "@nitpick/postgres";
import { Dashboard, Queue, Settings } from "@nitpick/review-server/web";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

const Live = Dashboard.layer.pipe(
  Layer.provideMerge(Queue.layer),
  Layer.provideMerge(Identity.layer),
  Layer.provideMerge(Settings.layer),
  Layer.provideMerge(Database.layer),
  Layer.provideMerge(Postgres.layer),
);

/** Built on the first request, so `next build` needs no database or secrets. */
export const AppRuntime = ManagedRuntime.make(Live);

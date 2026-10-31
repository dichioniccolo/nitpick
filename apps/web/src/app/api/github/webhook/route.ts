import { handleWebhook, verifySignature } from "@nitpick/review-server/web";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { AppRuntime } from "@/server/runtime";

const webhookSecret = Effect.gen(function* () {
  return yield* Config.Redacted("GITHUB_WEBHOOK_SECRET");
});

export const POST = async (request: Request): Promise<Response> => {
  const body = await request.text();
  const secret = await AppRuntime.runPromise(webhookSecret);

  if (!verifySignature(Redacted.value(secret), body, request.headers.get("x-hub-signature-256"))) {
    return new Response("invalid signature", { status: 401 });
  }

  const delivery = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event");

  if (delivery === null || event === null) return new Response("missing headers", { status: 400 });
  await AppRuntime.runPromise(handleWebhook(delivery, event, JSON.parse(body)).pipe(Effect.orDie));

  return new Response("accepted", { status: 202 });
};

import { Identity } from "@nitpick/identity-server";
import { Database, Postgres } from "@nitpick/postgres";
import { Pool } from "pg";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// The full GitHub sign-in against a real Postgres and a fake GitHub. Better-auth validates its
// fields only while creating a user, so a page test that stops at the redirect misses it.
// Run after `bun run e2e`, which migrates. Each case signs in the same person twice.
const appUrl = process.env.APP_URL ?? "";
const databaseUrl = process.env.DATABASE_URL ?? "";
const realFetch = globalThis.fetch;

const json = <A>(body: A, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// SAFETY: the fake answers the `(input, init)` form better-auth calls; `preconnect` goes unused.
const fakeGitHub = (emailStatus: number) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.includes("login/oauth/access_token")) {
      return json({ access_token: "fake", token_type: "bearer", scope: "" });
    }

    if (url.endsWith("/user")) {
      return json({
        id: 987,
        login: "octo",
        name: null,
        email: null,
        avatar_url: "https://x/a.png",
      });
    }

    if (url.endsWith("/user/emails")) {
      return emailStatus === 200
        ? json([{ email: "octo@nitpick.test", primary: true, verified: true }])
        : json({ message: "Resource not accessible by integration" }, emailStatus);
    }

    if (url.includes("/user/installations")) return json({ installations: [] });

    return realFetch(input, init);
  }) as typeof fetch;

let client = 0;

const signIn = Effect.gen(function* () {
  const identity = yield* Identity;
  // A new address per attempt, so better-auth's sign-in rate limit stays out of the check.
  const address = `203.0.113.${(client += 1)}`;

  const started = yield* Effect.promise(() =>
    identity.handler(
      new Request(`${appUrl}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: appUrl,
          "cf-connecting-ip": address,
        },
        body: JSON.stringify({ provider: "github", callbackURL: "/app" }),
      }),
    ),
  );

  const { url } = yield* Effect.promise(() => started.json());
  const state = new URL(url).searchParams.get("state");

  const cookie = started.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

  const finished = yield* Effect.promise(() =>
    identity.handler(
      new Request(`${appUrl}/api/auth/callback/github?code=x&state=${state}`, {
        headers: { cookie, "cf-connecting-ip": address },
      }),
    ),
  );

  const location = finished.headers.get("location") ?? "";

  if (!location.endsWith("/app")) throw new Error(`Sign-in ended at ${location}`);

  const session = finished.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

  const user = yield* Effect.flatMap(Identity, (service) =>
    service.userOf(new Headers({ cookie: session })),
  );

  if (user?.login !== "octo") throw new Error(`Session user is ${user?.login}`);
});

const Live = Identity.layer.pipe(
  Layer.provideMerge(Database.layer),
  Layer.provideMerge(Postgres.layer),
);

const pool = new Pool({ connectionString: databaseUrl });

for (const emailStatus of [403, 200]) {
  await pool.query(`delete from "user" where name = 'octo'`);
  globalThis.fetch = fakeGitHub(emailStatus);
  await Effect.runPromise(Effect.scoped(Effect.andThen(signIn, signIn)).pipe(Effect.provide(Live)));
  console.log(`GitHub sign-in works when /user/emails answers ${emailStatus}`);
}

await pool.end();

process.exit(0);

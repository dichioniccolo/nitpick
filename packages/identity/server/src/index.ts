import { repository } from "@nitpick/code-graph-tables";
import { repositoryMember } from "@nitpick/identity-tables";
import { Database } from "@nitpick/postgres";
import { betterAuth } from "better-auth";
import { eq, inArray } from "drizzle-orm";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";

import { accessibleRepositories } from "./GitHubAccess.ts";
import { type User, userOfSession } from "./Session.ts";

export type { User } from "./Session.ts";

/**
 * Short, with no sliding refresh: repository access is copied from GitHub at
 * sign-in, so a session must not outlive that copy by much.
 */
const SessionTtl = Duration.hours(8);

/** Replace a user's access with `reachable`, limited to repositories this database knows. */
export const replaceMembership = Effect.fn("identity.membership.replace")(function* (
  userId: string,
  reachable: ReadonlyArray<number>,
) {
  const db = yield* Database;
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.delete(repositoryMember).where(eq(repositoryMember.userId, userId));

        const known = yield* tx
          .select({ id: repository.id })
          .from(repository)
          .where(inArray(repository.id, [0, ...reachable]));

        if (known.length > 0) {
          yield* tx
            .insert(repositoryMember)
            .values(known.map((row) => ({ userId, repositoryId: row.id })));
        }
      }),
    )
    .pipe(Effect.orDie);
});

interface Settings {
  readonly secret: string;
  readonly appUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

const makeAuth = (
  settings: Settings,
  pool: Pool,
  refreshAccess: (userId: string) => Promise<void>,
) =>
  betterAuth({
    secret: settings.secret,
    baseURL: settings.appUrl,
    telemetry: { enabled: false },
    database: pool,
    advanced: {
      database: { generateId: () => uuidv7() },
      // Traffic reaches the pods through Cloudflare, so the socket address is never the client's.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    onAPIError: {
      errorURL: "/?signin=failed",
      onError: (error) => console.error("auth failure", error),
    },
    session: {
      modelName: "authSession",
      expiresIn: Math.floor(Duration.toSeconds(SessionTtl)),
      disableSessionRefresh: true,
    },
    account: { modelName: "authAccount", encryptOAuthTokens: true },
    verification: { modelName: "authVerification" },
    socialProviders: {
      github: {
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        overrideUserInfoOnSignIn: true,
        // A GitHub App without the email permission returns none, and better-auth requires one.
        mapProfileToUser: (profile) => ({
          name: profile.login,
          email: profile.email ?? `${profile.id}+${profile.login}@users.noreply.github.com`,
        }),
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            // A failed refresh leaves the previous access in place and still signs the user in.
            await refreshAccess(session.userId).catch((cause) => {
              console.error("repository access refresh failed", cause);
            });
          },
        },
      },
    },
  });

export type Auth = ReturnType<typeof makeAuth>;

export class Identity extends Context.Service<
  Identity,
  {
    readonly handler: (request: Request) => Promise<Response>;
    readonly userOf: (headers: Headers) => Effect.Effect<User | null>;
  }
>()("@nitpick/identity/Identity") {
  static readonly layer = Layer.effect(
    Identity,
    Effect.gen(function* () {
      const secret = yield* Config.Redacted("AUTH_SECRET");
      const databaseUrl = yield* Config.Redacted("DATABASE_URL");
      const appUrl = yield* Config.String("APP_URL");
      const clientId = yield* Config.String("GITHUB_CLIENT_ID");
      const clientSecret = yield* Config.Redacted("GITHUB_CLIENT_SECRET");

      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => new Pool({ connectionString: Redacted.value(databaseUrl), max: 5 })),
        (opened) => Effect.promise(() => opened.end()),
      );

      const context = yield* Effect.context<Database>();

      const auth: Auth = makeAuth(
        {
          secret: Redacted.value(secret),
          appUrl,
          clientId,
          clientSecret: Redacted.value(clientSecret),
        },
        pool,
        async (userId) => {
          const { internalAdapter } = await auth.$context;
          const accounts = await internalAdapter.findAccounts(userId);
          const account = accounts.find((item) => item.providerId === "github");

          if (account === undefined) return;

          const { accessToken } = await auth.api.getAccessToken({
            body: { accountId: account.id, userId },
          });

          await Effect.runPromiseWith(context)(
            accessibleRepositories(fetch, accessToken).pipe(
              Effect.flatMap((reachable) => replaceMembership(userId, reachable)),
            ),
          );
        },
      );

      return {
        handler: auth.handler,
        userOf: (headers) => userOfSession(() => auth.api.getSession({ headers })),
      };
    }),
  );
}

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

export interface User {
  readonly id: string;
  readonly login: string;
  readonly avatarUrl: string | null;
}

/**
 * Short, with no sliding refresh: repository access is copied from GitHub at
 * sign-in, so a session must not outlive that copy by much.
 */
const SessionTtl = Duration.hours(8);

/** GitHub caps pages at 100 rows; this bounds one sign-in to 1,000 repositories per installation. */
const maxPages = 10;

const github = async <A>(token: string, path: string): Promise<A> => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
  });

  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`);

  // SAFETY: GitHub's REST schema for `path`; a change there fails sign-in, not access checks.
  return (await response.json()) as A;
};

/** The ids of the repositories this GitHub user reaches through the App. */
const accessibleRepositories = async (token: string): Promise<ReadonlyArray<number>> => {
  const { installations } = await github<{ installations: ReadonlyArray<{ id: number }> }>(
    token,
    "/user/installations?per_page=100",
  );

  const ids: Array<number> = [];

  for (const item of installations) {
    for (let page = 1; page <= maxPages; page += 1) {
      const { repositories } = await github<{ repositories: ReadonlyArray<{ id: number }> }>(
        token,
        `/user/installations/${item.id}/repositories?per_page=100&page=${page}`,
      );

      ids.push(...repositories.map((row) => row.id));

      if (repositories.length < 100) break;
    }
  }

  return ids;
};

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
    advanced: { database: { generateId: () => uuidv7() } },
    onAPIError: { errorURL: "/?signin=failed" },
    user: {
      additionalFields: { login: { type: "string", required: true, input: false } },
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
        // A GitHub App without the email permission returns none, and better-auth requires one.
        mapProfileToUser: (profile) => ({
          login: profile.login,
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

          const reachable = await accessibleRepositories(accessToken);
          await Effect.runPromiseWith(context)(replaceMembership(userId, reachable));
        },
      );

      return {
        handler: auth.handler,
        userOf: (headers) =>
          Effect.promise(() => auth.api.getSession({ headers })).pipe(
            Effect.map((found) =>
              found === null
                ? null
                : {
                    id: found.user.id,
                    login: found.user.login,
                    avatarUrl: found.user.image ?? null,
                  },
            ),
          ),
      };
    }),
  );
}

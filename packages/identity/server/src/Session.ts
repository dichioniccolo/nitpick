import * as Effect from "effect/Effect";

export interface User {
  readonly id: string;
  readonly login: string;
  readonly avatarUrl: string | null;
}

interface Session {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly image?: string | null | undefined;
  };
}

/**
 * The user behind a session lookup, or `null`. A rejected lookup also reads as no
 * user: a database blip sends the visitor to sign in, it does not crash the page.
 */
export const userOfSession = (lookup: () => Promise<Session | null>): Effect.Effect<User | null> =>
  Effect.tryPromise(lookup).pipe(
    Effect.map((found) =>
      found === null
        ? null
        : { id: found.user.id, login: found.user.name, avatarUrl: found.user.image ?? null },
    ),
    Effect.catch((cause) => Effect.as(Effect.logWarning("session lookup failed", cause), null)),
  );

import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const repoName = "acme/billing";
const reviewId = "01960000-0000-7000-8000-000000000001";
const userId = "01960000-0000-7000-8000-000000000002";

/** Migrates, seeds one repository with one review, and signs in one user by writing a session row. */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const secret = process.env.AUTH_SECRET;

  if (url === undefined || secret === undefined)
    throw new Error("DATABASE_URL and AUTH_SECRET are required");
  const db = drizzle({ connection: { connectionString: url, max: 1 } });
  await migrate(db, { migrationsFolder: "migrations" });
  const client = db.$client;
  await client.query(
    `insert into installation (id, "accountLogin", "accountType") values (1, 'acme', 'Organization') on conflict do nothing`,
  );
  await client.query(
    `insert into repository (id, "installationId", "fullName", "defaultBranch", private, "indexStatus", "fileCount", "symbolCount", "indexedSha")
     values (10, 1, $1, 'main', true, 'ready', 12, 80, 'abcdef1') on conflict do nothing`,
    [repoName],
  );
  await client.query(
    `insert into "user" (id, name, email) values ($1, 'demo', 'demo@nitpick.test') on conflict do nothing`,
    [userId],
  );
  await client.query(
    `insert into repository_member ("userId", "repositoryId") values ($1, 10) on conflict do nothing`,
    [userId],
  );
  await client.query(
    `insert into review (id, "repositoryId", "prNumber", "prTitle", "prAuthor", "headSha", "baseSha", status, summary, confidence)
     values ($1, 10, 7, 'Store amounts in euros', 'demo', 'abcdef1', 'abcdef0', 'completed', 'Changes the unit of charge amounts.', 2)
     on conflict do nothing`,
    [reviewId],
  );
  const token = randomBytes(24).toString("base64url");
  await client.query(
    `insert into "authSession" (token, "userId", "expiresAt") values ($1, $2, now() + interval '8 hours')`,
    [token, userId],
  );
  await client.end();

  // better-call's cookie signature: `token.base64(hmac-sha256)`, URI-encoded.
  const value = encodeURIComponent(
    `${token}.${createHmac("sha256", secret).update(token).digest("base64")}`,
  );

  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync(
    "e2e/.auth/demo.json",
    JSON.stringify({
      cookies: [
        {
          name: "__Secure-better-auth.session_token",
          value,
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
  );
}

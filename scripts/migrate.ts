import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.DATABASE_URL;

if (url === undefined) throw new Error("DATABASE_URL is not set");

const db = drizzle({ connection: { connectionString: url, max: 1 } });

await migrate(db, { migrationsFolder: "migrations" });

await db.$client.end();

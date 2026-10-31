import { defineConfig } from "drizzle-kit";

// The database schema is the union of every slice's `tables` package.
export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/*/tables/src/*.table.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});

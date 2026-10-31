import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** A GitHub App installation. The primary key is GitHub's id. */
export const installation = pgTable("installation", {
  id: bigint({ mode: "number" }).primaryKey(),
  accountLogin: text().notNull(),
  accountType: text().notNull(),
  suspended: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** A repository the App can read. The primary key is GitHub's id. */
export const repository = pgTable(
  "repository",
  {
    id: bigint({ mode: "number" }).primaryKey(),
    installationId: bigint({ mode: "number" })
      .notNull()
      .references(() => installation.id, { onDelete: "cascade" }),
    fullName: text().notNull(),
    defaultBranch: text().notNull(),
    private: boolean().notNull(),
    enabled: boolean().notNull().default(true),
    indexStatus: text({ enum: ["pending", "indexing", "ready", "failed"] })
      .notNull()
      .default("pending"),
    indexedSha: text(),
    indexedAt: timestamp({ withTimezone: true }),
    indexError: text(),
    fileCount: integer().notNull().default(0),
    symbolCount: integer().notNull().default(0),
  },
  (table) => [index().on(table.installationId), index().on(table.fullName)],
);

/** One source file at the indexed commit. `hash` skips files that did not change. */
export const codeFile = pgTable(
  "code_file",
  {
    repositoryId: bigint({ mode: "number" })
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    path: text().notNull(),
    hash: text().notNull(),
    language: text(),
    content: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.repositoryId, table.path] })],
);

/** A definition in a file at the indexed commit. */
export const codeSymbol = pgTable(
  "code_symbol",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    repositoryId: bigint({ mode: "number" })
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    path: text().notNull(),
    name: text().notNull(),
    kind: text().notNull(),
    startLine: integer().notNull(),
    endLine: integer().notNull(),
    signature: text().notNull(),
    parent: text(),
  },
  (table) => [
    index().on(table.repositoryId, table.name),
    index().on(table.repositoryId, table.path),
    index("code_symbol_lower_name_idx").on(table.repositoryId, sql`lower(${table.name})`),
  ],
);

/** A use of a name, the edges of the graph. Names resolve at read time. */
export const codeRef = pgTable(
  "code_ref",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    repositoryId: bigint({ mode: "number" })
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    path: text().notNull(),
    name: text().notNull(),
    kind: text().notNull(),
    line: integer().notNull(),
    enclosing: text(),
  },
  (table) => [
    index().on(table.repositoryId, table.name),
    index().on(table.repositoryId, table.path),
  ],
);

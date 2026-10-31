import { repository } from "@nitpick/code-graph-tables";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

// `user`, `authSession`, `authAccount` and `authVerification` are better-auth's
// tables. Column names are the ones it reads, so a rename here breaks sign-in.
export const user = pgTable("user", {
  id: id(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  login: text().notNull(),
  ...timestamps,
});

export const authSession = pgTable(
  "authSession",
  {
    id: id(),
    token: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    ...timestamps,
  },
  (table) => [index().on(table.userId)],
);

export const authAccount = pgTable(
  "authAccount",
  {
    id: id(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (table) => [index().on(table.userId)],
);

export const authVerification = pgTable(
  "authVerification",
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index().on(table.identifier)],
);

/** The repositories GitHub says a user can see, replaced at each sign-in. All tenant checks read it. */
export const repositoryMember = pgTable(
  "repository_member",
  {
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: bigint({ mode: "number" })
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.repositoryId] })],
);

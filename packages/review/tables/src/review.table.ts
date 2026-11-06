import { repository } from "@nitpick/code-graph-tables";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** GitHub does not redeliver on its own; a delivery id seen before is a replay and is dropped. */
export const webhookDelivery = pgTable("webhook_delivery", {
  id: text().primaryKey(),
  receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * The Postgres work queue. `dedupeKey` keeps one queued job per PR head or repo;
 * `concurrencyKey` is the wider scope in which only one job may run at a time.
 */
export const job = pgTable(
  "job",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    kind: text().notNull(),
    dedupeKey: text().notNull(),
    concurrencyKey: text().notNull(),
    payload: jsonb().notNull(),
    status: text({ enum: ["queued", "running", "done", "failed"] })
      .notNull()
      .default("queued"),
    attempts: integer().notNull().default(0),
    runAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Renewed by a heartbeat; a lapsed lease means the worker died and the job is claimable. */
    lockedUntil: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("job_claim_idx").on(table.status, table.runAt),
    uniqueIndex("job_queued_dedupe_idx")
      .on(table.dedupeKey)
      .where(sql`${table.status} = 'queued'`),
    index("job_running_concurrency_idx")
      .on(table.concurrencyKey)
      .where(sql`${table.status} = 'running'`),
  ],
);

export const review = pgTable(
  "review",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    repositoryId: bigint({ mode: "number" })
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    prNumber: integer().notNull(),
    prTitle: text().notNull(),
    prAuthor: text().notNull(),
    headSha: text().notNull(),
    baseSha: text().notNull(),
    status: text({ enum: ["running", "completed", "skipped", "failed"] })
      .notNull()
      .default("running"),
    impact: text({ enum: ["low", "medium", "high"] }),
    /** One sentence after the impact label: what the reviewer thinks of the change. */
    verdict: text(),
    summary: text(),
    /** The summary's bullets, one per notable change. */
    changes: jsonb().$type<ReadonlyArray<string>>(),
    confidence: integer(),
    /** Findings an earlier head raised that this head still has. They count toward the score and the check. */
    repeated: jsonb().$type<
      ReadonlyArray<{
        readonly fingerprint: string;
        readonly severity: "P0" | "P1" | "P2" | "P3";
      }>
    >(),
    diagram: text(),
    error: text(),
    model: text(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    summaryCommentId: bigint({ mode: "number" }),
    /** The `nitpick` check run of this run. Cleared on restart unless a live run is reused. */
    checkRunId: bigint({ mode: "number" }),
    /** The conclusion this head earned, posted or not. Stored, so a later `failOn` never re-judges it. */
    checkConclusion: text({ enum: ["success", "failure", "neutral", "skipped"] }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Reset on every run, so the stuck-review sweep does not hit a retry of an old row. */
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index().on(table.repositoryId, table.createdAt),
    uniqueIndex("review_head_idx").on(table.repositoryId, table.prNumber, table.headSha),
  ],
);

export const finding = pgTable(
  "finding",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    reviewId: uuid()
      .notNull()
      .references(() => review.id, { onDelete: "cascade" }),
    repositoryId: bigint({ mode: "number" }).notNull(),
    prNumber: integer().notNull(),
    path: text().notNull(),
    startLine: integer(),
    line: integer().notNull(),
    severity: text({ enum: ["P0", "P1", "P2", "P3"] }).notNull(),
    category: text({
      enum: ["logic", "security", "performance", "reliability", "style", "testing", "rule"],
    }).notNull(),
    title: text().notNull(),
    body: text().notNull(),
    /** The input or state that triggers it. Null on findings from before the verifier. */
    scenario: text(),
    /** The code that proves it, as the reviewer cited it. */
    evidence: text(),
    suggestion: text(),
    /** Stable across pushes, so a finding already raised on this PR is not raised again. */
    fingerprint: text().notNull(),
    /** Null when GitHub could not place the comment; it then appears in the summary. */
    githubCommentId: bigint({ mode: "number" }),
    reactionsUp: integer().notNull().default(0),
    reactionsDown: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.reviewId),
    index().on(table.repositoryId, table.prNumber, table.fingerprint),
    index().on(table.githubCommentId),
  ],
);

/** A team instruction for reviews of one repository. */
export const rule = pgTable(
  "rule",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    repositoryId: bigint({ mode: "number" })
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    text: text().notNull(),
    enabled: boolean().notNull().default(true),
    createdByLogin: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.repositoryId)],
);

/** What the team taught through reactions and replies. One row per finding. */
export const learning = pgTable(
  "learning",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    repositoryId: bigint({ mode: "number" })
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    findingId: uuid()
      .notNull()
      .references(() => finding.id, { onDelete: "cascade" })
      .unique(),
    verdict: text({ enum: ["useful", "noise"] }).notNull(),
    text: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.repositoryId)],
);

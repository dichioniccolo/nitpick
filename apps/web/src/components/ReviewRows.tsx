import Link from "next/link";

import { Confidence } from "./Confidence";
import { StatusPill } from "./StatusPill";

export interface ReviewRow {
  readonly id: string;
  readonly fullName: string;
  readonly prNumber: number;
  readonly prTitle: string;
  readonly prAuthor: string;
  readonly status: string;
  readonly confidence: number | null;
  readonly findings: number;
  readonly createdAt: Date;
}

const Outcome = ({ row }: { row: ReviewRow }) => {
  if (row.status === "running") return <StatusPill tone="accent">Reviewing</StatusPill>;

  if (row.status === "failed") return <StatusPill tone="del">Review failed</StatusPill>;

  if (row.status === "skipped") return <StatusPill tone="soft">Skipped</StatusPill>;

  return row.findings === 0 ? (
    <StatusPill tone="add">No findings</StatusPill>
  ) : (
    <StatusPill tone="warn">{`${row.findings} ${row.findings === 1 ? "finding" : "findings"}`}</StatusPill>
  );
};

const units: ReadonlyArray<readonly [number, string]> = [
  [86_400_000, "d"],
  [3_600_000, "h"],
  [60_000, "min"],
];

const ageOf = (from: Date): string => {
  const elapsed = Date.now() - from.getTime();

  for (const [size, unit] of units) {
    if (elapsed >= size) return `${Math.floor(elapsed / size)} ${unit}`;
  }

  return "now";
};

const repositoryName = (fullName: string): string => fullName.split("/")[1] ?? fullName;

export const ReviewRows = ({ rows }: { rows: ReadonlyArray<ReviewRow> }) =>
  rows.length === 0 ? (
    <p className="rounded-2xl border border-rule bg-sheet p-5 text-soft">
      No reviews yet. Open a pull request on an enabled repository, or mention the App in a comment
      on one.
    </p>
  ) : (
    <ul className="rounded-2xl border border-rule bg-sheet p-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/app/reviews/${row.id}`}
            className="flex items-center gap-3 rounded-xl p-3 transition-colors duration-150 ease-out hover:bg-raised sm:gap-4"
          >
            <span
              aria-hidden="true"
              className="hidden size-9 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold text-soft uppercase sm:grid"
            >
              {row.prAuthor.slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{row.prTitle}</span>
              <span className="block truncate font-mono text-xs text-soft">
                {repositoryName(row.fullName)}#{row.prNumber} · {row.prAuthor}
              </span>
            </span>
            <span className="hidden sm:inline-flex">
              <Confidence value={row.confidence} />
            </span>
            <Outcome row={row} />
            <span className="hidden w-14 shrink-0 text-right font-mono text-xs text-soft sm:block">
              {ageOf(row.createdAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

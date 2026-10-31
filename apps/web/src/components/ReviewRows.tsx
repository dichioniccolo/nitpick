import Link from "next/link";

import { Confidence } from "./Confidence";

export interface ReviewRow {
  readonly id: string;
  readonly fullName: string;
  readonly prNumber: number;
  readonly prTitle: string;
  readonly prAuthor: string;
  readonly status: string;
  readonly confidence: number | null;
  readonly findings: number;
}

const outcome = (row: ReviewRow): string => {
  if (row.status === "running") return "Reviewing";

  if (row.status === "failed") return "Review failed";

  if (row.status === "skipped") return "Skipped";

  return row.findings === 0
    ? "No issues"
    : `${row.findings} ${row.findings === 1 ? "finding" : "findings"}`;
};

export const ReviewRows = ({ rows }: { rows: ReadonlyArray<ReviewRow> }) =>
  rows.length === 0 ? (
    <p className="py-4 text-soft">
      No reviews yet. Open a pull request on an enabled repository, or comment @nitpick review on
      one.
    </p>
  ) : (
    <ul className="divide-y divide-rule">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/app/reviews/${row.id}`}
            className="flex flex-wrap items-baseline gap-x-4 py-3 hover:bg-sheet"
          >
            <span className="min-w-0 flex-1 basis-64">
              <span className="font-medium">{row.prTitle}</span>
              <span className="block text-sm text-soft">
                {row.fullName}#{row.prNumber} by {row.prAuthor}
              </span>
            </span>
            <Confidence value={row.confidence} />
            <span
              className={`w-28 text-right text-sm ${row.status === "failed" ? "text-del" : ""}`}
            >
              {outcome(row)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

import Link from "next/link";
import { Suspense } from "react";

import { Confidence } from "@/components/Confidence";
import { RowsSkeleton } from "@/components/Skeleton";
import { dashboard } from "@/server/session";

const severityStyle: Readonly<Record<"critical" | "major" | "minor", string>> = {
  critical: "text-del font-bold",
  major: "text-del",
  minor: "text-soft",
};

interface Props {
  readonly params: Promise<{ id: string }>;
}

const Review = async ({ params }: Props) => {
  const { id } = await params;

  const { review, fullName, findings } = await dashboard((service, user) =>
    service.review(user.id, id),
  );

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{review.prTitle}</h1>
      <p className="mt-2 text-soft">
        <a
          href={`https://github.com/${fullName}/pull/${review.prNumber}`}
          className="underline underline-offset-4"
        >
          {fullName}#{review.prNumber}
        </a>{" "}
        by {review.prAuthor}, commit {review.headSha.slice(0, 7)}
      </p>
      {review.status === "running" && <p className="mt-6">Reviewing this commit.</p>}
      {review.status === "failed" && (
        <p className="mt-6 text-del">
          The review failed ({review.error}). Mention the App in a comment on the pull request to
          retry.
        </p>
      )}
      {review.summary !== null && (
        <section className="mt-6">
          <p className="mb-2 flex items-center gap-2 text-sm text-soft">
            Confidence to merge <Confidence value={review.confidence} />
          </p>
          <p className="max-w-[70ch] whitespace-pre-wrap">{review.summary}</p>
        </section>
      )}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Findings</h2>
        {findings.length === 0 && <p className="text-soft">Nothing to report on this commit.</p>}
        <ul className="divide-y divide-rule rounded-2xl border border-rule bg-sheet px-5 empty:hidden">
          {findings.map((item) => (
            <li key={item.id} className="py-4">
              <p className="font-mono text-sm text-soft">
                {item.path}:{item.line}
              </p>
              <p className="mt-1 font-bold">
                <span className={`mr-2 font-normal ${severityStyle[item.severity]}`}>
                  {item.severity}
                </span>
                {item.title}
              </p>
              <p className="mt-1 max-w-[70ch] whitespace-pre-wrap">{item.body}</p>
              {item.suggestion !== null && (
                <pre className="mt-2 overflow-x-auto rounded-lg border border-rule bg-paper p-3 font-mono text-sm">
                  {item.suggestion}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
};

export default function Page({ params }: Props) {
  return (
    <>
      <p data-testid="review-shell" className="mb-2 font-mono text-xs tracking-wider uppercase">
        <Link href="/app/reviews" className="text-soft hover:text-ink">
          Review
        </Link>
      </p>
      <Suspense fallback={<RowsSkeleton rows={5} />}>
        <Review params={params} />
      </Suspense>
    </>
  );
}

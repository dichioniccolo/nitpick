import Link from "next/link";
import { Suspense } from "react";

import { RowsSkeleton } from "@/components/Skeleton";
import { retriggerReview } from "@/server/actions";
import { dashboard } from "@/server/session";

interface Props {
  readonly params: Promise<{ id: string }>;
}

/** Opening this page changes nothing: a link preview or prefetch must not spend a review. */
const Confirm = async ({ params }: Props) => {
  const { id } = await params;

  const { review, fullName } = await dashboard((service, user) => service.review(user.id, id));

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Review again</h1>
      <p className="mt-2 text-soft">
        {fullName}#{review.prNumber}: {review.prTitle}
      </p>
      <p className="mt-6 max-w-[70ch]">
        Nitpick reviews the pull request&apos;s current head again and updates its comment and
        check. This spends API credits, like mentioning the App does.
      </p>
      <form action={retriggerReview} className="mt-6">
        <input type="hidden" name="reviewId" value={review.id} />
        <button
          type="submit"
          className="rounded-lg border border-rule bg-sheet px-4 py-2 font-semibold hover:bg-paper"
        >
          Review again
        </button>
      </form>
    </>
  );
};

export default function Page({ params }: Props) {
  return (
    <>
      <p data-testid="retrigger-shell" className="mb-2 font-mono text-xs tracking-wider uppercase">
        <Link href="/app/reviews" className="text-soft hover:text-ink">
          Review
        </Link>
      </p>
      <Suspense fallback={<RowsSkeleton rows={3} />}>
        <Confirm params={params} />
      </Suspense>
    </>
  );
}

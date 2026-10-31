import { Suspense } from "react";

import { ReviewRows } from "@/components/ReviewRows";
import { RowsSkeleton } from "@/components/Skeleton";
import { dashboard } from "@/server/session";

const Reviews = async () => {
  const reviews = await dashboard((service, user) => service.recentReviews(user.id, null));

  return <ReviewRows rows={reviews} />;
};

export default function Page() {
  return (
    <>
      <p
        data-testid="reviews-shell"
        className="font-mono text-xs tracking-wider text-soft uppercase"
      >
        All repositories
      </p>
      <h1 className="mt-2 mb-8 text-4xl font-semibold tracking-tight sm:text-5xl">Reviews</h1>
      <Suspense fallback={<RowsSkeleton rows={8} />}>
        <Reviews />
      </Suspense>
    </>
  );
}

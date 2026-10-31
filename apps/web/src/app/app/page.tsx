import { Settings } from "@nitpick/review-server/web";
import * as Effect from "effect/Effect";
import Link from "next/link";
import { Suspense } from "react";

import { SignInButton } from "@/components/AuthButtons";
import { ReviewRows } from "@/components/ReviewRows";
import { RowsSkeleton } from "@/components/Skeleton";
import { AppRuntime } from "@/server/runtime";
import { dashboard, requireUser } from "@/server/session";

type IndexStatus = "pending" | "indexing" | "ready" | "failed";

const indexLabel: Readonly<Record<IndexStatus, string>> = {
  pending: "Waiting to read",
  indexing: "Reading",
  ready: "Ready",
  failed: "Could not read",
};

const Repositories = async () => {
  await requireUser();
  const { appSlug } = await AppRuntime.runPromise(Effect.service(Settings));
  const repositories = await dashboard((service, user) => service.repositories(user.id));
  const installUrl = `https://github.com/apps/${appSlug}/installations/new`;

  return (
    <>
      {repositories.length === 0 ? (
        <p className="py-4 text-soft">
          None yet.{" "}
          <a href={installUrl} className="underline">
            Install the GitHub App
          </a>
          , then <SignInButton className="underline">sign in again</SignInButton> to see them here.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-rule">
          {repositories.map((repo) => (
            <li key={repo.id}>
              <Link
                href={`/app/repos/${repo.fullName}`}
                className="flex items-baseline justify-between gap-4 py-3 hover:bg-sheet"
              >
                <span className="font-medium">{repo.fullName}</span>
                <span
                  className={`text-sm ${repo.indexStatus === "failed" ? "text-del" : "text-soft"}`}
                >
                  {repo.enabled ? indexLabel[repo.indexStatus] : "Reviews off"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <a href={installUrl} className="mt-3 inline-block text-sm underline underline-offset-4">
        Add repositories on GitHub
      </a>
    </>
  );
};

const Reviews = async () => {
  const reviews = await dashboard((service, user) => service.recentReviews(user.id, null));

  return <ReviewRows rows={reviews} />;
};

export default function Page() {
  return (
    <>
      <section>
        <h1 data-testid="repositories-shell" className="text-2xl font-bold">
          Repositories
        </h1>
        <Suspense fallback={<RowsSkeleton />}>
          <Repositories />
        </Suspense>
      </section>
      <section className="mt-10">
        <h2 className="text-2xl font-bold">Recent reviews</h2>
        <Suspense fallback={<RowsSkeleton />}>
          <Reviews />
        </Suspense>
      </section>
    </>
  );
}

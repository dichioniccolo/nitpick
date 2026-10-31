import { Settings } from "@nitpick/review-server/web";
import * as Effect from "effect/Effect";
import Link from "next/link";
import { Suspense } from "react";

import { SignInButton } from "@/components/AuthButtons";
import { ReviewRows } from "@/components/ReviewRows";
import { RowsSkeleton } from "@/components/Skeleton";
import { StatusPill } from "@/components/StatusPill";
import { AppRuntime } from "@/server/runtime";
import { dashboard, requireUser } from "@/server/session";

type IndexStatus = "pending" | "indexing" | "ready" | "failed";

const indexLabel: Readonly<Record<IndexStatus, string>> = {
  pending: "Waiting to read",
  indexing: "Reading",
  ready: "Ready",
  failed: "Could not read",
};

const indexTone = { pending: "soft", indexing: "accent", ready: "add", failed: "del" } as const;

const FailedRepositories = async () => {
  const repositories = await dashboard((service, user) => service.repositories(user.id));
  const failed = repositories.filter((repo) => repo.enabled && repo.indexStatus === "failed");

  return failed.map((repo) => (
    <div
      key={repo.id}
      className="mb-8 flex items-center gap-4 rounded-2xl border border-del/25 bg-del/5 p-4 sm:p-5"
    >
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-del/15 text-del"
      >
        !
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{repo.fullName} could not be read</p>
        <p className="truncate font-mono text-xs text-soft">{repo.indexError}</p>
      </div>
      <Link href={`/app/repos/${repo.fullName}`} className="shrink-0 text-sm font-medium text-del">
        Details
      </Link>
    </div>
  ));
};

const Repositories = async () => {
  await requireUser();
  const { appSlug } = await AppRuntime.runPromise(Effect.service(Settings));
  const repositories = await dashboard((service, user) => service.repositories(user.id));
  const installUrl = `https://github.com/apps/${appSlug}/installations/new`;

  return (
    <>
      {repositories.length === 0 ? (
        <p className="rounded-2xl border border-rule bg-sheet p-5 text-soft">
          None yet.{" "}
          <a href={installUrl} className="underline">
            Install the GitHub App
          </a>
          , then <SignInButton className="underline">sign in again</SignInButton> to see them here.
        </p>
      ) : (
        <ul className="rounded-2xl border border-rule bg-sheet p-2">
          {repositories.map((repo) => (
            <li key={repo.id}>
              <Link
                href={`/app/repos/${repo.fullName}`}
                className="flex items-center justify-between gap-4 rounded-xl p-3 transition-colors duration-150 ease-out hover:bg-raised"
              >
                <span className="min-w-0 truncate font-medium">{repo.fullName}</span>
                {repo.enabled ? (
                  <StatusPill tone={indexTone[repo.indexStatus]}>
                    {indexLabel[repo.indexStatus]}
                  </StatusPill>
                ) : (
                  <StatusPill tone="soft">Reviews off</StatusPill>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <a href={installUrl} className="mt-3 inline-block text-sm text-soft hover:text-ink">
        Add repositories on GitHub
      </a>
    </>
  );
};

const Reviews = async () => {
  const reviews = await dashboard((service, user) => service.recentReviews(user.id, null));

  return <ReviewRows rows={reviews.slice(0, 5)} />;
};

export default function Page() {
  return (
    <>
      <p
        data-testid="repositories-shell"
        className="font-mono text-xs tracking-wider text-soft uppercase"
      >
        All repositories
      </p>
      <h1 className="mt-2 mb-8 text-4xl font-semibold tracking-tight sm:text-5xl">Overview</h1>
      <Suspense>
        <FailedRepositories />
      </Suspense>
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Recent reviews</h2>
          <Link href="/app/reviews" className="text-sm text-soft hover:text-ink">
            View all
          </Link>
        </div>
        <Suspense fallback={<RowsSkeleton rows={5} />}>
          <Reviews />
        </Suspense>
      </section>
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Repositories</h2>
        <Suspense fallback={<RowsSkeleton />}>
          <Repositories />
        </Suspense>
      </section>
    </>
  );
}

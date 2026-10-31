import Link from "next/link";
import { type ReactNode, Suspense } from "react";

import { ShellBar } from "@/components/ShellBar";
import { dashboard, requireUser } from "@/server/session";

const Bar = async () => {
  const user = await requireUser();
  const repositories = await dashboard((service, current) => service.repositories(current.id));

  const reviews = await dashboard((service, current) => service.recentReviews(current.id, null));

  return (
    <ShellBar
      login={user.login}
      avatarUrl={user.avatarUrl}
      repositories={repositories.map(({ fullName, indexStatus, enabled }) => ({
        fullName,
        indexStatus,
        enabled,
      }))}
      reviews={reviews.map(({ id, fullName, prNumber, prTitle }) => ({
        id,
        fullName,
        prNumber,
        prTitle,
      }))}
    />
  );
};

const BarSkeleton = () => (
  <div aria-hidden="true" className="flex flex-1 items-center">
    <div className="h-5 w-32 rounded-sm bg-sheet" />
    <div className="ml-auto h-8 w-8 rounded-full bg-sheet sm:w-52" />
  </div>
);

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-rule bg-paper px-3 sm:gap-2 sm:px-6">
        <Link href="/app" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="grid size-6 place-items-center rounded-md bg-accent text-xs font-bold text-paper"
          >
            ✓
          </span>
          <span className="hidden sm:inline">nitpick</span>
        </Link>
        <span aria-hidden="true" className="mx-1 text-soft sm:mx-2">
          /
        </span>
        <Suspense fallback={<BarSkeleton />}>
          <Bar />
        </Suspense>
      </header>
      <main className="mx-auto max-w-[56rem] px-4 py-8 sm:px-8 sm:py-14">{children}</main>
    </div>
  );
}

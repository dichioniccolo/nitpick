import Link from "next/link";
import { Suspense } from "react";

import { ReviewRows } from "@/components/ReviewRows";
import { RowsSkeleton } from "@/components/Skeleton";
import { addRule, deleteRule, reindex, toggleRepository, toggleRule } from "@/server/actions";
import { dashboard } from "@/server/session";

interface IndexState {
  readonly indexStatus: string;
  readonly fileCount: number;
  readonly symbolCount: number;
  readonly indexedSha: string | null;
  readonly indexError: string | null;
}

const indexSummary = (repo: IndexState): string => {
  if (repo.indexStatus === "ready") {
    return `${repo.fileCount} files and ${repo.symbolCount} symbols read at ${repo.indexedSha?.slice(0, 7)}`;
  }

  if (repo.indexStatus === "failed") return `Could not read this repository: ${repo.indexError}`;

  return "Reading the repository";
};

interface Props {
  readonly params: Promise<{ owner: string; repo: string }>;
}

const Repository = async ({ params }: Props) => {
  const { owner, repo: name } = await params;
  const fullName = `${owner}/${name}`;
  const repo = await dashboard((service, user) => service.repository(user.id, fullName));
  const rules = await dashboard((service, user) => service.rules(user.id, repo.id));
  const learnings = await dashboard((service, user) => service.learnings(user.id, repo.id));
  const reviews = await dashboard((service, user) => service.recentReviews(user.id, repo.id));

  const hidden = (
    <>
      <input type="hidden" name="repositoryId" value={repo.id} />
      <input type="hidden" name="fullName" value={fullName} />
    </>
  );

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight break-words sm:text-4xl">{fullName}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="text-soft">{indexSummary(repo)}</span>
        <form action={reindex}>
          {hidden}
          <button type="submit" className="underline underline-offset-4">
            Read again
          </button>
        </form>
        <form action={toggleRepository}>
          {hidden}
          <input type="hidden" name="enabled" value={String(!repo.enabled)} />
          <button type="submit" className="underline underline-offset-4">
            {repo.enabled ? "Turn reviews off" : "Turn reviews on"}
          </button>
        </form>
      </div>

      <section className="mt-10">
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Team rules</h2>
        <p className="text-sm text-soft">
          Nitpick checks every pull request against these. A breach is always reported.
        </p>
        <ul className="mt-3 divide-y divide-rule rounded-2xl border border-rule bg-sheet px-4 empty:hidden">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-baseline gap-4 py-2">
              <span className={`flex-1 ${rule.enabled ? "" : "text-soft line-through"}`}>
                {rule.text}
              </span>
              <form action={toggleRule}>
                {hidden}
                <input type="hidden" name="ruleId" value={rule.id} />
                <input type="hidden" name="enabled" value={String(!rule.enabled)} />
                <button type="submit" className="text-sm underline underline-offset-4">
                  {rule.enabled ? "Pause" : "Resume"}
                </button>
              </form>
              <form action={deleteRule}>
                {hidden}
                <input type="hidden" name="ruleId" value={rule.id} />
                <button type="submit" className="text-sm text-del underline underline-offset-4">
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addRule} className="mt-3 flex gap-2">
          {hidden}
          <label className="flex-1">
            <span className="sr-only">New rule</span>
            <input
              name="text"
              required
              maxLength={2000}
              placeholder="Database calls go through a repository class"
              className="w-full rounded-lg border border-rule bg-sheet px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-ink px-4 py-2 font-medium text-paper transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            Add rule
          </button>
        </form>
      </section>

      {learnings.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold">Learned from reactions</h2>
          <ul className="mt-3 divide-y divide-rule rounded-2xl border border-rule bg-sheet px-4">
            {learnings.map((item) => (
              <li key={item.id} className="flex items-baseline gap-4 py-2">
                <span
                  className={`w-16 text-sm ${item.verdict === "noise" ? "text-del" : "text-add"}`}
                >
                  {item.verdict === "noise" ? "Avoid" : "Useful"}
                </span>
                <span className="flex-1">{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Reviews</h2>
        <ReviewRows rows={reviews} />
      </section>
    </>
  );
};

export default function Page({ params }: Props) {
  return (
    <>
      <p data-testid="repository-shell" className="mb-2 font-mono text-xs tracking-wider uppercase">
        <Link href="/app" className="text-soft hover:text-ink">
          Repository
        </Link>
      </p>
      <Suspense fallback={<RowsSkeleton rows={6} />}>
        <Repository params={params} />
      </Suspense>
    </>
  );
}

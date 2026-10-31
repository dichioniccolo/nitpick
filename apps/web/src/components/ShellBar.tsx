"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { signOut, SignOutButton } from "./AuthButtons";

export interface ShellRepository {
  readonly fullName: string;
  readonly indexStatus: string;
  readonly enabled: boolean;
}

export interface ShellReview {
  readonly id: string;
  readonly fullName: string;
  readonly prNumber: number;
  readonly prTitle: string;
}

interface Props {
  readonly login: string;
  readonly avatarUrl: string | null;
  readonly repositories: ReadonlyArray<ShellRepository>;
  readonly reviews: ReadonlyArray<ShellReview>;
}

interface Action {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly run: () => void;
}

const shortName = (fullName: string): string => fullName.split("/")[1] ?? fullName;

/** Type to narrow, arrows to move, enter to run. The switcher and the palette share it. */
const Picklist = ({
  actions,
  placeholder,
  close,
}: {
  readonly actions: ReadonlyArray<Action>;
  readonly placeholder: string;
  readonly close: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const needle = query.toLowerCase();
  const matches = actions.filter((action) => action.label.toLowerCase().includes(needle));

  useEffect(() => input.current?.focus(), []);

  const run = (action: Action | undefined) => {
    if (action === undefined) return;
    action.run();
    close();
  };

  return (
    <>
      <input
        ref={input}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setCursor(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setCursor(Math.min(cursor + 1, matches.length - 1));
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setCursor(Math.max(cursor - 1, 0));
          }

          if (event.key === "Enter") run(matches[cursor]);

          if (event.key === "Escape") close();
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{ outline: "none" }}
        className="w-full border-b border-rule bg-transparent px-4 py-3 text-sm"
      />
      <ul className="max-h-80 overflow-y-auto p-1.5">
        {matches.map((action, index) => (
          <li key={action.id}>
            <button
              type="button"
              onClick={() => run(action)}
              onMouseEnter={() => setCursor(index)}
              className={`flex w-full items-baseline justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm ${index === cursor ? "bg-raised" : ""}`}
            >
              <span className="truncate">{action.label}</span>
              <span className="shrink-0 font-mono text-xs text-soft">{action.hint}</span>
            </button>
          </li>
        ))}
        {matches.length === 0 && <li className="px-3 py-2 text-sm text-soft">No match.</li>}
      </ul>
    </>
  );
};

const palettePosition: CSSProperties & { "--origin": string } = { "--origin": "top center" };

export const ShellBar = ({ login, avatarUrl, repositories, reviews }: Props) => {
  const router = useRouter();
  const pathname = usePathname();
  const [palette, setPalette] = useState(false);
  const [switcher, setSwitcher] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSwitcher(false);
        setPalette((open) => !open);
      }
    };

    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const reviewId = /^\/app\/reviews\/(.+)$/.exec(pathname)?.[1];
  const repoName = /^\/app\/repos\/(.+)$/.exec(pathname)?.[1];
  const current = repoName ?? reviews.find((review) => review.id === reviewId)?.fullName ?? null;

  const repoActions = repositories.map((repo) => ({
    id: repo.fullName,
    label: repo.fullName,
    hint: repo.enabled ? (repo.indexStatus === "ready" ? "" : repo.indexStatus) : "off",
    run: () => router.push(`/app/repos/${repo.fullName}`),
  }));

  const actions: ReadonlyArray<Action> = [
    { id: "overview", label: "Overview", hint: "Go", run: () => router.push("/app") },
    { id: "reviews", label: "All reviews", hint: "Go", run: () => router.push("/app/reviews") },
    ...repoActions.map((action) => ({ ...action, hint: "Repository" })),
    ...reviews.map((review) => ({
      id: review.id,
      label: review.prTitle,
      hint: `${shortName(review.fullName)}#${review.prNumber}`,
      run: () => router.push(`/app/reviews/${review.id}`),
    })),
    { id: "sign-out", label: "Sign out", hint: "Account", run: signOut },
  ];

  return (
    <>
      <div className="relative min-w-0">
        <button
          type="button"
          aria-expanded={switcher}
          onClick={() => setSwitcher(!switcher)}
          className="flex max-w-44 items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium transition-colors duration-150 ease-out hover:bg-sheet active:scale-[0.97]"
        >
          <span className="truncate">
            {current === null ? "All repositories" : shortName(current)}
          </span>
          <span aria-hidden="true" className="text-soft">
            ⌄
          </span>
        </button>
        {switcher && (
          <>
            <button
              type="button"
              aria-label="Close"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setSwitcher(false)}
            />
            <div className="pop absolute top-full left-0 z-50 mt-2 w-80 max-w-[85vw] overflow-hidden rounded-xl border border-rule bg-sheet shadow-2xl">
              <Picklist
                actions={[
                  {
                    id: "all",
                    label: "All repositories",
                    hint: "",
                    run: () => router.push("/app"),
                  },
                  ...repoActions,
                ]}
                placeholder="Switch repository"
                close={() => setSwitcher(false)}
              />
            </div>
          </>
        )}
      </div>
      <Link
        href="/app/reviews"
        className={`ml-2 hidden text-sm transition-colors duration-150 ease-out hover:text-ink sm:block ${pathname.startsWith("/app/reviews") ? "text-ink" : "text-soft"}`}
      >
        Reviews
      </Link>
      <div className="ml-auto flex items-center gap-3 sm:gap-4">
        <button
          type="button"
          aria-label="Jump to"
          onClick={() => setPalette(true)}
          className="flex items-center gap-2 rounded-full border border-rule bg-sheet px-3 py-1.5 text-sm text-soft transition-colors duration-150 ease-out hover:text-ink active:scale-[0.97] sm:w-52"
        >
          <span aria-hidden="true">⌕</span>
          <span className="hidden sm:inline">Jump to…</span>
          <kbd className="ml-auto hidden rounded-full bg-raised px-2 py-0.5 font-mono text-xs sm:inline">
            ⌘K
          </kbd>
        </button>
        <span className="hidden sm:inline">
          <SignOutButton />
        </span>
        {avatarUrl === null ? (
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-full bg-ink text-xs font-semibold text-paper uppercase"
          >
            {login.slice(0, 2)}
          </span>
        ) : (
          <Image
            src={avatarUrl}
            alt=""
            width={32}
            height={32}
            unoptimized
            className="rounded-full"
          />
        )}
      </div>
      {palette && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 cursor-default bg-paper/70"
            onClick={() => setPalette(false)}
          />
          <div
            style={palettePosition}
            className="pop relative mx-auto mt-[12vh] w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-rule bg-sheet shadow-2xl"
          >
            <Picklist
              actions={actions}
              placeholder="Jump to a repository or review"
              close={() => setPalette(false)}
            />
          </div>
        </div>
      )}
    </>
  );
};

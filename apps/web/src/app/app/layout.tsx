import Image from "next/image";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";

import { SignOutButton } from "@/components/AuthButtons";
import { requireUser } from "@/server/session";

const Account = async () => {
  const user = await requireUser();

  return (
    <div className="flex items-center gap-3 text-sm">
      {user.avatarUrl !== null && (
        <Image
          src={user.avatarUrl}
          alt=""
          width={24}
          height={24}
          unoptimized
          className="rounded-full"
        />
      )}
      <span>{user.login}</span>
      <SignOutButton />
    </div>
  );
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-8">
      <header className="flex h-16 items-center justify-between border-b border-rule">
        <Link href="/app" className="text-lg font-bold">
          nitpick
        </Link>
        <Suspense fallback={<div aria-hidden="true" className="h-6 w-32 rounded-sm bg-rule" />}>
          <Account />
        </Suspense>
      </header>
      <main className="py-8">{children}</main>
    </div>
  );
}

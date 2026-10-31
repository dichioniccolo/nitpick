import Link from "next/link";

const NotFound = () => (
  <main className="mx-auto max-w-xl px-4 py-24">
    <h1 className="text-3xl font-bold">Nothing here</h1>
    <p className="mt-2 text-soft">
      This page does not exist, or your GitHub account cannot see that repository.
    </p>
    <Link href="/app" className="mt-4 inline-block underline underline-offset-4">
      Go to your repositories
    </Link>
  </main>
);

export default NotFound;

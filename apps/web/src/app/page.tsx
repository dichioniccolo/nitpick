import { Suspense } from "react";

import { SignInButton } from "@/components/AuthButtons";

interface Props {
  readonly searchParams: Promise<{ signin?: string }>;
}

const steps = [
  [
    "Install the GitHub App",
    "Pick the repositories. Nitpick reads each one and maps its functions, types and call sites.",
  ],
  [
    "Open a pull request",
    "Nitpick follows the change into the files it touches, including the ones the diff leaves out.",
  ],
  [
    "Read the comments",
    "Findings land on the exact lines. Each one says what breaks and under which input.",
  ],
  [
    "Teach it",
    "Thumbs down a comment and Nitpick stops raising that kind of thing. Team rules go in the dashboard.",
  ],
];

const signColor = (sign: string): string => {
  if (sign === "+") return "text-add";

  return sign === "-" ? "text-del" : "text-soft";
};

const Line = ({ n, sign, children }: { n: string; sign: string; children: string }) => (
  <div className="flex">
    <span className="w-10 shrink-0 select-none text-right text-soft">{n}</span>
    <span className={`w-6 shrink-0 select-none text-center ${signColor(sign)}`}>{sign}</span>
    <span className="whitespace-pre">{children}</span>
  </div>
);

const SignInNotice = async ({ searchParams }: Props) => {
  const { signin } = await searchParams;

  if (signin === "failed")
    return (
      <p className="mt-4 text-del">GitHub sign-in failed. Start again from Sign in with GitHub.</p>
    );

  if (signin === "required") return <p className="mt-4 text-del">Sign in to open the dashboard.</p>;

  return null;
};

export default function Page({ searchParams }: Props) {
  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-8">
      <nav className="flex items-center justify-between py-6">
        <span className="text-xl font-bold">nitpick</span>
        <SignInButton>Sign in with GitHub</SignInButton>
      </nav>

      <section className="pt-10 pb-16">
        <h1
          data-testid="landing-shell"
          className="max-w-3xl text-5xl leading-[1.05] font-bold tracking-tight sm:text-7xl"
        >
          The bug is in the file you didn't change.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-soft">
          Nitpick reviews pull requests against your whole codebase, so it sees the caller your diff
          just broke. It runs on your own cluster.
        </p>
        <Suspense fallback={null}>
          <SignInNotice searchParams={searchParams} />
        </Suspense>

        <figure className="mt-12 overflow-x-auto rounded-sm border border-rule bg-sheet py-4 font-mono text-sm leading-6">
          <figcaption className="px-4 pb-3 text-soft">src/billing/charge.ts</figcaption>
          <Line n="41" sign=" ">
            {"export function charge(order: Order) {"}
          </Line>
          <Line n="42" sign="-">
            {"  const total = sum(order.lines);"}
          </Line>
          <div className="flex">
            <span className="w-10 shrink-0 select-none text-right text-soft">42</span>
            <span className="w-6 shrink-0 select-none text-center text-add">+</span>
            <span className="sweep whitespace-pre">
              {"  const total = sum(order.lines) / 100;"}
            </span>
          </div>
          <Line n="43" sign=" ">
            {"  return gateway.capture(order.id, total);"}
          </Line>
          <div className="lands my-3 ml-16 max-w-xl border-l-4 border-marker pl-4 font-sans text-base">
            <p className="font-bold">Refunds now pay out 100 times too little</p>
            <p className="text-soft">
              <code className="font-mono text-sm">refund()</code> in{" "}
              <code className="font-mono text-sm">src/billing/refund.ts:18</code> still passes cents
              to <code className="font-mono text-sm">gateway.capture</code>, which this line changes
              to euros.
            </p>
          </div>
          <Line n="44" sign=" ">
            {"}"}
          </Line>
        </figure>
      </section>

      <section className="grid gap-10 border-t border-rule py-14 sm:grid-cols-2">
        {steps.map(([title, body], index) => (
          <div key={title} className="flex gap-4">
            <span className="text-2xl font-bold text-soft">{index + 1}</span>
            <div>
              <h2 className="text-xl font-bold">{title}</h2>
              <p className="mt-1 text-soft">{body}</p>
            </div>
          </div>
        ))}
      </section>

      <footer className="border-t border-rule py-8 text-soft">
        Your code stays in your Postgres. Only the code a review reads goes to the model.
      </footer>
    </main>
  );
}

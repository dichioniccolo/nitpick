"use client";

import { createAuthClient } from "better-auth/react";

const client = createAuthClient();

export const SignInButton = ({ children, className }: { children: string; className?: string }) => (
  <button
    type="button"
    className={className ?? "font-medium underline underline-offset-4"}
    onClick={() => void client.signIn.social({ provider: "github", callbackURL: "/app" })}
  >
    {children}
  </button>
);

export const signOut = (): void => void client.signOut().then(() => window.location.assign("/"));

export const SignOutButton = () => (
  <button
    type="button"
    className="text-sm text-soft transition-colors duration-150 ease-out hover:text-ink"
    onClick={signOut}
  >
    Sign out
  </button>
);

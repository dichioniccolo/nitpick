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

export const SignOutButton = () => (
  <button
    type="button"
    className="underline underline-offset-4"
    onClick={() => void client.signOut().then(() => window.location.assign("/"))}
  >
    Sign out
  </button>
);

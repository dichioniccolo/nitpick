import type { Metadata } from "next";
import { Familjen_Grotesk, IBM_Plex_Mono } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const familjen = Familjen_Grotesk({ subsets: ["latin"], variable: "--font-familjen" });

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Nitpick",
  description: "Pull request reviews that read your whole codebase, on your own cluster.",
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en" className={`${familjen.variable} ${plexMono.variable}`}>
    <body>{children}</body>
  </html>
);

export default RootLayout;

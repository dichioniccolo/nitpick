import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Nitpick",
  description: "Pull request reviews that read your whole codebase, on your own cluster.",
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
    <body>{children}</body>
  </html>
);

export default RootLayout;

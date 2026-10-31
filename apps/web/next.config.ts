import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // Every route prerenders a static shell, request data streams into it behind
  // Suspense, and links prefetch that shell, so a click paints at once.
  // See instant-nav.rig.md.
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The Playwright `instant()` API, for guard builds only. The image never sets it.
    exposeTestingApiInProductionBuild: process.env.EXPOSE_TESTING_API === "1",
    staleTimes: { dynamic: 30 },
  },
  transpilePackages: [
    "@nitpick/code-graph-tables",
    "@nitpick/identity-server",
    "@nitpick/identity-tables",
    "@nitpick/postgres",
    "@nitpick/review-domain",
    "@nitpick/review-server",
    "@nitpick/review-tables",
    "@nitpick/review-use-cases",
  ],
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  headers: async () => [{ source: "/(.*)", headers: securityHeaders }],
};

export default nextConfig;

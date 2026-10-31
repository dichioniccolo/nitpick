# syntax=docker/dockerfile:1.7
# Two images for the k3s cluster (charts/nitpick). `web` (the default target)
# is the Next.js standalone server on Node. `worker` is the bundled job runner
# on Bun, with the tree-sitter wasm files and the migrations, and also runs the
# migration hook.

FROM node:26.12.1-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
RUN npm install -g --no-fund --no-audit bun@1.4.4
COPY . .
RUN bun install --frozen-lockfile
ENV NODE_ENV=production
RUN bun run --cwd apps/web build && bun run --cwd apps/worker build

FROM oven/bun:1.4.4-slim AS worker
WORKDIR /app
ENV NODE_ENV=production TREE_SITTER_GRAMMARS=/app/dist/wasm MIGRATIONS_DIR=/app/migrations
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/migrations ./migrations
USER 1001
CMD ["bun", "dist/main.js"]

FROM node:26.12.1-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER 1001
EXPOSE 3000
# V8 sizes its heap from the machine, not the cgroup limit.
CMD ["node", "--max-old-space-size=384", "apps/web/server.js"]

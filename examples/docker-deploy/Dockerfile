# syntax=docker/dockerfile:1

# Production-hardened Dockerfile for timber.js with Nitro node-server preset.
# See design/25-production-deployments.md for rationale.
#
# Build:  docker build -t my-timber-app .
# Run:    docker run -p 3000:3000 my-timber-app

# ── Stage 1: Install dependencies + build ─────────────────────────────────────

FROM node:24-slim AS build

# Enable corepack so pnpm version is locked to packageManager in package.json
RUN corepack enable

WORKDIR /app

# Copy package manifests first — changes less often than source code,
# so Docker layer caching keeps the pnpm install step cached.
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for the build step).
# BuildKit cache mount keeps the pnpm store across builds.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source code and build
COPY . .
RUN pnpm run build

# ── Stage 2: Production runtime ───────────────────────────────────────────────

FROM node:24-slim AS runtime

RUN corepack enable

# Non-root user — never run production workloads as root.
RUN groupadd --system timber && \
    useradd --system --gid timber --create-home timber

WORKDIR /app

# Copy build output only — no source code, no devDependencies.
# Nitro node-server preset outputs to .output/
COPY --from=build --chown=timber:timber /app/.output ./.output

# If your app has production-only dependencies that Nitro doesn't bundle,
# uncomment the following lines:
# COPY --from=build --chown=timber:timber /app/package.json ./
# RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
#     pnpm install --prod --frozen-lockfile

USER timber

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# Health check for orchestrator liveness probes (k8s, ECS, Docker Compose).
# Checks that the server responds to HTTP requests.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:${PORT}/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Nitro node-server handles SIGTERM gracefully — in-flight requests complete
# before the process exits. Docker sends SIGTERM on `docker stop`.
CMD ["node", ".output/server/index.mjs"]

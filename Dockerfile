# ─── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /build

# Skip Puppeteer's bundled Chromium download — the app uses a custom PDF writer
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Copy the Prisma schemas before npm ci so the postinstall script (prisma generate) can find them
COPY server/prisma ./server/prisma

# Install ALL workspace dependencies (server postinstall → prisma generate runs with schema present)
RUN npm ci

# Copy remaining source (no PII spreadsheets — see .dockerignore / runtime notes)
COPY packages/ ./packages/
COPY server/src ./server/src
COPY server/tsconfig.json ./server/tsconfig.json
COPY client/ ./client/
COPY data/ ./data/

# 1. Build shared package (required before server & client TypeScript compilation)
RUN npm run build:shared

# 2. Build server (TypeScript → dist/)
RUN npm run build -w server

# 3. Build client SPA with the production API URL baked in
ARG VITE_API_URL=http://localhost:3000/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w client

# Drop build-only tools from node_modules before copying to runtime.
# prisma / tsx / cross-env stay (moved to server dependencies) for migrate + seed.
RUN npm prune --omit=dev

# ─── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system makthab \
  && useradd --system --gid makthab --home-dir /app --shell /usr/sbin/nologin makthab

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production

# Pruned node_modules from builder (no jest/typescript/etc.)
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/server/node_modules ./server/node_modules

# Copy workspace manifests (needed by Node.js workspace resolution at runtime)
COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Copy Prisma schemas + the generated clients (generated at build time by prisma generate)
COPY --from=builder /build/server/prisma ./server/prisma

# Copy compiled server output
COPY --from=builder /build/server/dist ./server/dist

# Copy shared dist (needed by server at runtime via CJS require)
COPY --from=builder /build/packages/shared/dist ./packages/shared/dist

# Copy built client SPA (served as static files by Express in production)
COPY --from=builder /build/client/dist ./client-dist

# Empty data tree for uploads/receipts (never bake a local SQLite DB or PII)
COPY --from=builder /build/data ./data

# Entrypoint: migrate on every boot; seed only when no users exist yet.
# Legacy xlsx import is opt-in via RUN_XLSX_IMPORT + a runtime mount — the
# spreadsheet is intentionally NOT copied into the image (student/fee PII).
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh \
  && chown -R makthab:makthab /app

USER makthab

EXPOSE 3000

# start-period gives the FIRST boot (migrate + seed) room to finish before the
# orchestrator can mark the container unhealthy; subsequent boots skip seed and
# become healthy quickly. Pair with a matching ECS/ALB
# healthCheckGracePeriodSeconds (>= start-period).
HEALTHCHECK --interval=15s --timeout=3s --start-period=120s --retries=6 \
  CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]

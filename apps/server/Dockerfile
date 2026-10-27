# =============================================================================
# HavenWorld Server — Multi-Stage Production Dockerfile
# =============================================================================
# Usage:  docker build -t havenworld-server -f apps/server/Dockerfile .
# Runtime:  docker run -p 3000:3000 --env-file .env havenworld-server
# =============================================================================

# ── Build Stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Install pnpm for reproducible dependency installation
RUN npm install -g pnpm@9.15.9

WORKDIR /app

# Copy lockfile, workspace config, and package manifests for dependency layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Install dependencies (prod + dev for build)
RUN pnpm install --frozen-lockfile --filter server...

# Copy full source tree (shared package + server)
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

# Build shared package first (server depends on it)
RUN pnpm --filter @havenworld/shared build

# Generate Prisma client before building server TypeScript
RUN pnpm --filter server exec prisma generate --schema=prisma/schema.prisma

# Build server TypeScript
RUN pnpm --filter server build

# Deploy isolated production bundle with only production dependencies
RUN pnpm --filter=server deploy --prod /app/deploy

# Copy built dist files and prisma schema into production bundle
RUN cp -r /app/apps/server/dist /app/deploy/dist && \
    cp -r /app/apps/server/prisma /app/deploy/prisma

# Generate Prisma client inside the isolated production bundle using server's prisma CLI
RUN /app/apps/server/node_modules/.bin/prisma generate --schema=/app/deploy/prisma/schema.prisma

# ── Runtime Stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S havenworld && \
    adduser -u 1001 -S havenworld -G havenworld

# Copy only production bundle from builder with non-root ownership
COPY --chown=havenworld:havenworld --from=builder /app/deploy ./

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV PRISMA_GENERATE_SKIP_DOWNLOAD=true

# Health check (hits /health endpoint)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run as non-root
USER havenworld

EXPOSE 3000

CMD ["node", "dist/index.js"]

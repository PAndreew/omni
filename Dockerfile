# ─── Stage 1: Build the React client ────────────────────────────────────────
FROM oven/bun:1-slim AS client-builder

WORKDIR /build/client

# Cache dependency install separately from source
COPY client/package.json bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY client/ ./
RUN bun run build


# ─── Stage 2: Production server ──────────────────────────────────────────────
FROM oven/bun:1-slim AS final

# Install cec-utils and playerctl for CEC + audio metadata (optional, gracefully skipped if missing)
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends cec-utils playerctl && \
    rm -rf /var/lib/apt/lists/* || true

WORKDIR /app/server

# Cache server deps
COPY server/package.json bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy server source
COPY server/ ./

# Copy built frontend into expected location (served as static files)
COPY --from=client-builder /build/client/dist /app/client/dist

# Persistent volume for SQLite database
VOLUME ["/app/server/data"]

EXPOSE 3001

ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/app/server/data/omniwall.db

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "fetch('http://localhost:3001/api/weather').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "index.js"]

# ─── Stage 1: Build the React client ────────────────────────────────────────
FROM oven/bun:1-slim AS client-builder

WORKDIR /build/client
COPY client/package.json ./
RUN bun install
COPY client/ ./
RUN bun run build


# ─── Stage 2: Compile native server dependencies for ARM64 ─────────────────
FROM node:22-bookworm-slim AS server-deps

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /build/server
COPY server/package.json ./
RUN npm install --omit=dev


# ─── Stage 3: Small production runtime ─────────────────────────────────────
FROM node:22-bookworm-slim AS final

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends cec-utils playerctl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY --from=server-deps /build/server/node_modules ./node_modules
COPY server/ ./
COPY --from=client-builder /build/client/dist /app/client/dist

VOLUME ["/app/server/data"]
EXPOSE 3001

ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/app/server/data/omniwall.db

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]

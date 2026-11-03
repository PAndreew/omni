# Replaceable frontend only. APIs, terminals and workers run in the persistent
# host runtime installed by install-runtime.sh.
FROM oven/bun:1-slim AS client-builder
WORKDIR /build/client
COPY client/package.json ./
RUN bun install
COPY client/ ./
RUN bun run build

FROM node:22-bookworm-slim AS final
WORKDIR /app/server
RUN npm install --omit=dev --no-audit --no-fund express@4.21.2
COPY server/web.js ./web.js
COPY server/public ./public
COPY --from=client-builder /build/client/dist /app/client/dist
EXPOSE 3001
ENV NODE_ENV=production PORT=3001
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "web.js"]

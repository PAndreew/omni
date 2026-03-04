#!/usr/bin/env bash
# OmniWall startup script
# Usage:
#   ./start.sh          → bare-metal dev mode (server + vite)
#   ./start.sh prod     → bare-metal production (build client, run server)
#   ./start.sh deploy   → rebuild client + restart server + restart kiosk (TV)
#   ./start.sh docker   → build & run via docker-compose
#   ./start.sh docker-build → rebuild Docker image

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

print_banner() {
  echo ""
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║        OmniWall Family Hub           ║"
  echo "  ╚══════════════════════════════════════╝"
  echo ""
}

MODE=${1:-dev}
print_banner

case "$MODE" in

  docker)
    echo "🐋  Starting via Docker Compose..."
    [ -f .env ] || cp .env.example .env && echo "  ℹ️  Created .env from .env.example — edit it to set your location."
    docker compose up -d
    echo ""
    echo "  ✅  OmniWall running at http://$(hostname -I | awk '{print $1}'):${PORT:-3001}"
    echo "  📋  Logs: docker compose logs -f"
    echo "  🛑  Stop: docker compose down"
    ;;

  docker-build)
    echo "🏗️  Rebuilding Docker image..."
    docker compose build --no-cache
    echo "  ✅  Image rebuilt. Run './start.sh docker' to start."
    ;;

  deploy)
    echo "  Building frontend..."
    cd client && bun run build && cd ..
    echo "  Restarting server..."
    systemctl --user restart omniwall-server.service
    # Wait for server to accept connections
    for i in $(seq 1 20); do
      curl -sf http://localhost:3001/api/weather > /dev/null && break
      sleep 1
    done
    echo "  Restarting kiosk browser..."
    systemctl --user restart omniwall-kiosk.service
    echo ""
    echo "  Done. Kiosk will reload — DSI-2 will be killed in ~8s after it starts."
    ;;

  prod)
    echo "  Building frontend..."
    cd client && bun install --frozen-lockfile 2>/dev/null || bun install
    bun run build
    cd ..
    echo "🚀  Starting server (production)..."
    cd server && bun install --frozen-lockfile 2>/dev/null || bun install
    node --env-file=.env --import tsx/esm index.js
    ;;

  dev|*)
    echo "🛠️   Starting in development mode (bare-metal)..."
    # Install deps if needed
    [ -d node_modules ]        || bun install
    [ -d server/node_modules ] || (cd server && bun install)
    [ -d client/node_modules ] || (cd client && bun install)

    # Run server + vite dev server concurrently
    bun x concurrently \
      --names "SERVER,CLIENT" \
      --prefix-colors "cyan,magenta" \
      --kill-others-on-fail \
      "cd server && node --env-file=.env --import tsx/esm --watch index.js" \
      "cd client && bun run dev"
    ;;

esac

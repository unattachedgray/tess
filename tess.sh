#!/bin/bash
# Tess — Board game learning platform launcher
# Usage: ./tess.sh [install|dev|prod|stop|status]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-8082}"
CLIENT_PORT=5174

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[tess]${NC} $*"; }
warn() { echo -e "${YELLOW}[tess]${NC} $*"; }
err() { echo -e "${RED}[tess]${NC} $*"; }

# --- Dependency checks ---

check_node() {
    if ! command -v node &>/dev/null; then
        err "Node.js is required. Install from https://nodejs.org/"
        exit 1
    fi
    local ver
    ver=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$ver" -lt 20 ]; then
        err "Node.js 20+ required (found v$ver)"
        exit 1
    fi
    log "Node.js $(node -v)"
}

check_pnpm() {
    if ! command -v pnpm &>/dev/null; then
        log "Installing pnpm..."
        npm install -g pnpm
    fi
    log "pnpm $(pnpm -v)"
}

check_engines() {
    local engine_dir="assets/engines"
    mkdir -p "$engine_dir"

    # If engines missing, download them
    if [ ! -f "$engine_dir/fairy-stockfish" ]; then
        warn "Chess engine not found."
        log "Attempting to download engines..."
        bash scripts/download-engines.sh --all
    else
        # Report what's available
        log "Chess engine: OK"
        ([ -f "$engine_dir/fairy-stockfish-largeboard" ] || [ -f "$engine_dir/fairy-stockfish-largeboard_x86-64-bmi2.exe" ]) \
            && log "Janggi engine: OK" || warn "Janggi engine: MISSING (will use Chess engine as fallback)"
        ([ -d "$engine_dir/katago" ] && ([ -f "$engine_dir/katago/katago" ] || [ -f "$engine_dir/katago/katago-cuda" ])) \
            && log "Go engine: OK" || warn "Go engine: MISSING (Go games unavailable)"
    fi
}

check_gateway() {
    if [ -n "${CREDENTIALS_DIRECTORY:-}" ] && [ -r "$CREDENTIALS_DIRECTORY/cascade-key" ]; then
        log "Economy gateway credential: available"
    else
        warn "Coaching requires the dedicated gateway credential; games work without coaching."
    fi
}

# --- Actions ---

do_install() {
    log "Installing dependencies..."
    check_node
    check_pnpm
    pnpm install
    pnpm rebuild better-sqlite3 2>/dev/null || true
    check_engines
    check_gateway
    # Generate sound files if missing
    if [ ! -f "packages/client/public/sounds/move.mp3" ]; then
        bash scripts/download-engines.sh --sounds-only
    fi
    log "Building client..."
    pnpm run build
    log ""
    log "Installation complete! Run: ./tess.sh dev"
}

do_dev() {
    check_engines
    log "Starting development servers..."
    log "  Client: http://localhost:$CLIENT_PORT"
    log "  Server: http://localhost:$PORT"
    echo ""
    pnpm run dev
}

do_prod() {
    warn "Production is managed by weft-tess.service. See docs/isolated-runtime.md."
    warn "This launcher will not start an owner-account production server."
    return 1
}

do_stop() {
    warn "Stop development with Ctrl-C in its terminal. Production uses weft-tess.service."
    warn "This launcher will not kill processes by command-line matching."
    return 1
}

do_status() {
    echo ""
    echo -e "${BLUE}Tess Status${NC}"
    echo "─────────────────────"

    # Check server
    if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
        local health
        health=$(curl -sf "http://localhost:$PORT/api/health")
        echo -e "Server:  ${GREEN}Running${NC} on port $PORT"
        echo "  $(echo "$health" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(f"Uptime: {d[\"uptime\"]}s | Games: {d[\"activeGames\"]} | Memory: {d[\"memoryMB\"]}MB")' 2>/dev/null || echo "$health")"
    else
        echo -e "Server:  ${RED}Not running${NC}"
    fi

    # Check client
    if curl -sf "http://localhost:$CLIENT_PORT" >/dev/null 2>&1; then
        echo -e "Client:  ${GREEN}Running${NC} on port $CLIENT_PORT (dev mode)"
    fi

    # Check engines
    echo ""
    [ -f "assets/engines/fairy-stockfish" ] && echo -e "Chess:   ${GREEN}OK${NC}" || echo -e "Chess:   ${RED}Missing${NC}"
    [ -d "assets/engines/katago" ] && echo -e "Go:      ${GREEN}OK${NC}" || echo -e "Go:      ${YELLOW}Missing${NC}"
    ([ -f "assets/engines/fairy-stockfish-largeboard" ] || [ -f "assets/engines/fairy-stockfish-largeboard_x86-64-bmi2.exe" ]) && echo -e "Janggi:  ${GREEN}OK${NC}" || echo -e "Janggi:  ${YELLOW}Missing${NC}"
    check_gateway
    echo ""
}

open_browser() {
    local url="$1"
    sleep 2
    if command -v xdg-open &>/dev/null; then
        xdg-open "$url" 2>/dev/null
    elif command -v wslview &>/dev/null; then
        wslview "$url" 2>/dev/null
    elif command -v open &>/dev/null; then
        open "$url" 2>/dev/null
    elif command -v cmd.exe &>/dev/null; then
        cmd.exe /c start "$url" 2>/dev/null
    fi
}

# --- Main ---

MODE="${1:-}"

case "$MODE" in
    install)
        do_install
        ;;
    dev)
        do_dev
        ;;
    prod)
        do_prod
        ;;
    stop)
        do_stop
        ;;
    status)
        do_status
        ;;
    "")
        # Default: install if needed, then launch prod with browser
        if [ ! -d "node_modules" ]; then
            do_install
        fi
        do_prod
        ;;
    *)
        echo "Usage: ./tess.sh [install|dev|prod|stop|status]"
        echo ""
        echo "  install  Install dependencies, check engines, build"
        echo "  dev      Start development servers (hot reload)"
        echo "  prod     Build and start production server"
        echo "  stop     Stop all Tess processes"
        echo "  status   Show server status and engine availability"
        echo ""
        echo "  (no args) Install if needed, then start production"
        exit 1
        ;;
esac

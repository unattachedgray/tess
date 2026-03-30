#!/bin/bash
set -e

MODE="${1:-dev}"

check_engines() {
    local engine_dir="assets/engines"

    if [ ! -f "$engine_dir/fairy-stockfish" ]; then
        echo "Engines not found. Run: ./scripts/download-engines.sh"
    else
        echo "Fairy-Stockfish: OK"
    fi
}

case "$MODE" in
    install)
        echo "Installing dependencies..."
        pnpm install
        check_engines
        echo "Done."
        ;;

    dev)
        check_engines
        echo "Starting dev servers..."
        pnpm run dev
        ;;

    prod)
        check_engines
        echo "Building client..."
        pnpm run build
        echo "Starting production server..."
        cd packages/server
        npx tsx src/index.ts
        ;;

    *)
        echo "Usage: ./start.sh [install|dev|prod]"
        exit 1
        ;;
esac

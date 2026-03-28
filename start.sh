#!/bin/bash
set -e

MODE="${1:-dev}"

check_engines() {
    local engine_dir="assets/engines"
    local boardgames_dir="../boardgames/assets/engines"

    if [ ! -f "$engine_dir/fairy-stockfish" ]; then
        if [ -f "$boardgames_dir/fairy-stockfish" ]; then
            echo "Symlinking engines from boardgames..."
            mkdir -p "$engine_dir"
            ln -sf "$(realpath "$boardgames_dir/fairy-stockfish")" "$engine_dir/fairy-stockfish"
            [ -f "$boardgames_dir/nn-46832cfbead3.nnue" ] && \
                ln -sf "$(realpath "$boardgames_dir/nn-46832cfbead3.nnue")" "$engine_dir/nn-46832cfbead3.nnue"
        else
            echo "WARNING: Fairy-Stockfish not found."
            echo "Place binary at $engine_dir/fairy-stockfish"
        fi
    fi

    if [ -f "$engine_dir/fairy-stockfish" ]; then
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

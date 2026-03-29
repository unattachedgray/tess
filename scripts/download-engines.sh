#!/bin/bash
# Download engine binaries for Tess
# Usage: ./scripts/download-engines.sh [--chess-only|--go-only|--all]
#
# Downloads Fairy-Stockfish (chess/janggi) and KataGo (go) binaries
# for Linux/WSL2 x86_64 systems.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENGINE_DIR="$ROOT_DIR/assets/engines"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[engines]${NC} $*"; }
warn() { echo -e "${YELLOW}[engines]${NC} $*"; }
err() { echo -e "${RED}[engines]${NC} $*"; }
info() { echo -e "${BLUE}[engines]${NC} $*"; }

# Detect architecture
ARCH=$(uname -m)
OS=$(uname -s)

if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "amd64" ]; then
    warn "Detected architecture: $ARCH"
    warn "Pre-built binaries are for x86_64. You may need to compile from source."
fi

mkdir -p "$ENGINE_DIR"
mkdir -p "$ENGINE_DIR/katago"

# --- Fairy-Stockfish ---

FAIRY_SF_VERSION="fairy_sf_14_0_1"
FAIRY_SF_REPO="https://github.com/fairy-stockfish/Fairy-Stockfish/releases/download"

download_fairy_stockfish() {
    log "Downloading Fairy-Stockfish (Chess + Janggi engine)..."

    local binary_name="fairy-stockfish-largeboard_x86-64-bmi2"
    local url="$FAIRY_SF_REPO/$FAIRY_SF_VERSION/$binary_name"

    if [ -f "$ENGINE_DIR/fairy-stockfish" ]; then
        log "Chess engine already exists, skipping."
    else
        info "Downloading: $url"
        if curl -fSL -o "$ENGINE_DIR/fairy-stockfish" "$url" 2>/dev/null; then
            chmod +x "$ENGINE_DIR/fairy-stockfish"
            log "Chess engine downloaded successfully."
        elif wget -q -O "$ENGINE_DIR/fairy-stockfish" "$url" 2>/dev/null; then
            chmod +x "$ENGINE_DIR/fairy-stockfish"
            log "Chess engine downloaded successfully."
        else
            err "Failed to download Fairy-Stockfish."
            err ""
            err "Manual download instructions:"
            err "  1. Go to: https://github.com/fairy-stockfish/Fairy-Stockfish/releases"
            err "  2. Find the latest release for your platform"
            err "  3. For Linux x86_64, look for: fairy-stockfish-largeboard_x86-64-bmi2"
            err "     For other architectures, look for the matching binary"
            err "  4. Download and place at: $ENGINE_DIR/fairy-stockfish"
            err "  5. Make it executable: chmod +x $ENGINE_DIR/fairy-stockfish"
            err ""
            err "  Alternative: search GitHub for 'fairy-stockfish' compatible with your system."
            return 1
        fi
    fi

    # Also set up as Janggi engine (same binary, different config)
    if [ ! -f "$ENGINE_DIR/fairy-stockfish-largeboard" ]; then
        cp "$ENGINE_DIR/fairy-stockfish" "$ENGINE_DIR/fairy-stockfish-largeboard"
        chmod +x "$ENGINE_DIR/fairy-stockfish-largeboard"
        log "Janggi engine set up (copy of Fairy-Stockfish)."
    fi
}

download_nnue() {
    # NNUE files improve engine strength but are optional
    local chess_nnue="nn-46832cfbead3.nnue"
    local chess_nnue_url="https://tests.stockfishchess.org/api/nn/$chess_nnue"

    if [ -f "$ENGINE_DIR/$chess_nnue" ]; then
        log "Chess NNUE already exists, skipping."
    else
        info "Downloading Chess NNUE (~48MB)..."
        if curl -fSL -o "$ENGINE_DIR/$chess_nnue" "$chess_nnue_url" 2>/dev/null || \
           wget -q -O "$ENGINE_DIR/$chess_nnue" "$chess_nnue_url" 2>/dev/null; then
            log "Chess NNUE downloaded."
        else
            warn "NNUE download failed. Engine will work but with reduced strength."
            warn "  Manual: download from https://tests.stockfishchess.org/api/nn/$chess_nnue"
        fi
    fi
}

# --- KataGo ---

KATAGO_VERSION="v1.15.3"
KATAGO_REPO="https://github.com/lightvector/KataGo/releases/download"

download_katago() {
    log "Downloading KataGo (Go engine)..."

    local katago_dir="$ENGINE_DIR/katago"

    # Check for existing binary
    if [ -f "$katago_dir/katago" ] || [ -f "$katago_dir/katago-cuda" ]; then
        log "KataGo binary already exists, skipping."
    else
        # Try CPU (Eigen) version — works everywhere
        local eigen_zip="katago-${KATAGO_VERSION}-eigen-linux-x64.zip"
        local eigen_url="$KATAGO_REPO/$KATAGO_VERSION/$eigen_zip"

        info "Downloading KataGo CPU (Eigen) version..."
        local tmpfile="/tmp/katago-download-$$.zip"

        if curl -fSL -o "$tmpfile" "$eigen_url" 2>/dev/null || \
           wget -q -O "$tmpfile" "$eigen_url" 2>/dev/null; then
            # Extract binary from zip
            if command -v unzip &>/dev/null; then
                unzip -o -j "$tmpfile" "katago" -d "$katago_dir" 2>/dev/null || \
                unzip -o "$tmpfile" -d "/tmp/katago-extract-$$" 2>/dev/null
                # Some zips have the binary in a subdirectory
                if [ ! -f "$katago_dir/katago" ] && [ -d "/tmp/katago-extract-$$" ]; then
                    find "/tmp/katago-extract-$$" -name "katago" -type f -exec cp {} "$katago_dir/katago" \;
                    rm -rf "/tmp/katago-extract-$$"
                fi
            else
                err "unzip not found. Install with: sudo apt install unzip"
                err "Then re-run this script."
                rm -f "$tmpfile"
                return 1
            fi
            rm -f "$tmpfile"

            if [ -f "$katago_dir/katago" ]; then
                chmod +x "$katago_dir/katago"
                log "KataGo CPU binary downloaded."
            else
                err "Failed to extract KataGo binary from archive."
            fi
        else
            err "Failed to download KataGo."
            err ""
            err "Manual download instructions:"
            err "  1. Go to: https://github.com/lightvector/KataGo/releases"
            err "  2. Download the Eigen (CPU) version for your platform:"
            err "     Linux x64: katago-${KATAGO_VERSION}-eigen-linux-x64.zip"
            err "     If you have an NVIDIA GPU: katago-${KATAGO_VERSION}-cuda11.1-linux-x64.zip"
            err "  3. Extract the 'katago' binary to: $katago_dir/"
            err "  4. Make executable: chmod +x $katago_dir/katago"
            err ""
            err "  For GPU (CUDA): name the binary katago-cuda instead of katago"
            return 1
        fi
    fi

    # Download neural network model
    if [ -f "$katago_dir/default_model.bin.gz" ]; then
        log "KataGo model already exists, skipping."
    else
        info "Downloading KataGo neural network model (~94MB)..."
        # Use the b18 model bundled with KataGo releases
        local model_url="https://github.com/lightvector/KataGo/releases/download/v1.4.5/g170e-b20c256x2-s5303129600-d1228401921.bin.gz"

        if curl -fSL -o "$katago_dir/default_model.bin.gz" "$model_url" 2>/dev/null || \
           wget -q -O "$katago_dir/default_model.bin.gz" "$model_url" 2>/dev/null; then
            log "KataGo model downloaded."
        else
            warn "Model download failed."
            warn "  Manual: go to https://katagotraining.org/networks/"
            warn "  Download a 20-block (b20) model and save as:"
            warn "  $katago_dir/default_model.bin.gz"
        fi
    fi

    # Create default GTP config if missing
    if [ ! -f "$katago_dir/default_gtp.cfg" ]; then
        info "Creating default KataGo configuration..."
        cat > "$katago_dir/default_gtp.cfg" << 'KATACFG'
# KataGo GTP configuration for Tess
# Minimal config — Tess overrides key settings at runtime

logDir = gtp_logs
logAllGTPCommunication = false
logSearchInfo = false
logToStderr = false

rules = chinese
maxVisits = 500
numSearchThreads = 4

# Uncomment for GPU acceleration:
# nnMaxBatchSize = 64
# nnCacheSizePowerOfTwo = 23
KATACFG
        log "KataGo config created."
    fi
}

# --- Sound files ---

download_sounds() {
    local sounds_dir="$ROOT_DIR/packages/client/public/sounds"
    mkdir -p "$sounds_dir"

    # Generate minimal sound files using a simple approach
    # These are tiny placeholder beeps — replace with proper sounds later
    if [ -f "$sounds_dir/move.mp3" ]; then
        log "Sound files already exist, skipping."
        return 0
    fi

    info "Generating placeholder sound effects..."

    # Check if ffmpeg is available for generating sounds
    if command -v ffmpeg &>/dev/null; then
        # Generate short tones using ffmpeg (available on most Linux)
        ffmpeg -f lavfi -i "sine=frequency=600:duration=0.08" -q:a 9 "$sounds_dir/move.mp3" -y 2>/dev/null
        ffmpeg -f lavfi -i "sine=frequency=800:duration=0.1" -q:a 9 "$sounds_dir/capture.mp3" -y 2>/dev/null
        ffmpeg -f lavfi -i "sine=frequency=1000:duration=0.15" -q:a 9 "$sounds_dir/check.mp3" -y 2>/dev/null
        ffmpeg -f lavfi -i "sine=frequency=440:duration=0.3" -q:a 9 "$sounds_dir/gameEnd.mp3" -y 2>/dev/null
        log "Sound effects generated."
    else
        # Create minimal valid MP3 files (silent)
        # This prevents browser errors without needing ffmpeg
        # Smallest valid MP3 frame (MPEG1 Layer3, 128kbps, 44100Hz, mono, ~0.026s)
        local mp3_header
        mp3_header=$(printf '\xff\xfb\x90\x00')
        for name in move capture check gameEnd; do
            printf '%s' "$mp3_header" > "$sounds_dir/$name.mp3"
            # Pad to make it a valid frame
            dd if=/dev/zero bs=417 count=1 >> "$sounds_dir/$name.mp3" 2>/dev/null
        done
        warn "Created silent placeholder sounds (ffmpeg not found)."
        warn "  For real sounds, install ffmpeg and re-run, or add your own MP3 files to:"
        warn "  $sounds_dir/"
    fi
}

# --- Main ---

show_summary() {
    echo ""
    echo -e "${BLUE}Engine Status${NC}"
    echo "─────────────────────"
    [ -f "$ENGINE_DIR/fairy-stockfish" ] && echo -e "  Chess:   ${GREEN}OK${NC}" || echo -e "  Chess:   ${RED}Missing${NC}"
    [ -f "$ENGINE_DIR/fairy-stockfish-largeboard" ] && echo -e "  Janggi:  ${GREEN}OK${NC}" || echo -e "  Janggi:  ${YELLOW}Missing${NC}"
    ([ -f "$ENGINE_DIR/katago/katago" ] || [ -f "$ENGINE_DIR/katago/katago-cuda" ]) && echo -e "  Go:      ${GREEN}OK${NC}" || echo -e "  Go:      ${YELLOW}Missing${NC}"
    [ -f "$ENGINE_DIR/katago/default_model.bin.gz" ] && echo -e "  Model:   ${GREEN}OK${NC}" || echo -e "  Model:   ${YELLOW}Missing${NC}"
    [ -f "$ENGINE_DIR/katago/default_gtp.cfg" ] && echo -e "  Config:  ${GREEN}OK${NC}" || echo -e "  Config:  ${YELLOW}Missing${NC}"
    echo ""

    # Count available games
    local games=0
    [ -f "$ENGINE_DIR/fairy-stockfish" ] && games=$((games + 2))  # chess + janggi
    ([ -f "$ENGINE_DIR/katago/katago" ] || [ -f "$ENGINE_DIR/katago/katago-cuda" ]) && games=$((games + 1))

    if [ "$games" -eq 3 ]; then
        log "All 3 games ready (Chess, Janggi, Go)"
    elif [ "$games" -gt 0 ]; then
        warn "$games of 3 games ready. Missing engines can be added later."
    else
        err "No engines installed. At minimum, Chess engine is required."
    fi
}

MODE="${1:-all}"

case "$MODE" in
    --chess-only)
        download_fairy_stockfish
        download_nnue
        ;;
    --go-only)
        download_katago
        ;;
    --all|"")
        download_fairy_stockfish
        download_nnue
        download_katago
        download_sounds
        ;;
    --sounds-only)
        download_sounds
        ;;
    --help|-h)
        echo "Usage: ./scripts/download-engines.sh [--all|--chess-only|--go-only|--sounds-only]"
        echo ""
        echo "Downloads engine binaries for Tess board game platform."
        echo ""
        echo "Options:"
        echo "  --all          Download all engines + sounds (default)"
        echo "  --chess-only   Download Fairy-Stockfish only (chess + janggi)"
        echo "  --go-only      Download KataGo only (Go)"
        echo "  --sounds-only  Generate sound effects only"
        echo ""
        echo "Engines are saved to: assets/engines/"
        echo "Sounds are saved to:  packages/client/public/sounds/"
        exit 0
        ;;
    *)
        err "Unknown option: $MODE"
        echo "Run with --help for usage."
        exit 1
        ;;
esac

show_summary

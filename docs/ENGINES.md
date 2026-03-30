# Engine Setup

Tess uses external engine binaries for AI opponents. This guide covers how to obtain and configure them.

All binaries go in the `assets/engines/` directory (gitignored).

## Required Directory Structure

```
assets/engines/
├── fairy-stockfish                         # Chess engine (required)
├── nn-46832cfbead3.nnue                    # Chess NNUE eval (recommended)
├── fairy-stockfish-largeboard              # Janggi engine (optional)
├── janggi-9991472750de.nnue               # Janggi NNUE eval (optional)
└── katago/                                 # Go engine directory (optional)
    ├── katago                              # KataGo CPU binary
    ├── katago-cuda                         # KataGo CUDA binary (optional)
    ├── default_gtp.cfg                     # GTP config file
    └── default_model.bin.gz               # Neural network model
```

## Fairy-Stockfish (Chess)

Fairy-Stockfish is a Stockfish fork that supports chess variants including Janggi.

### Download

**GitHub Releases**: https://github.com/fairy-stockfish/Fairy-Stockfish/releases

Download the binary for your platform:

- **Linux x86_64**: `fairy-stockfish-largeboard_x86-64-bmi2` (or the non-largeboard variant for chess only)
- **Linux x86_64 (older CPUs)**: `fairy-stockfish-largeboard_x86-64`

### Linux / WSL2 Setup

```bash
cd assets/engines

# Download (adjust URL for latest release)
wget https://github.com/fairy-stockfish/Fairy-Stockfish/releases/download/fairy_sf_14_0_1/fairy-stockfish-largeboard_x86-64-bmi2
mv fairy-stockfish-largeboard_x86-64-bmi2 fairy-stockfish

# Make executable
chmod +x fairy-stockfish

# Verify
./fairy-stockfish <<< "uci" | head -5
```

You should see `id name Fairy-Stockfish ...` in the output.

### NNUE Evaluation File

The NNUE file improves engine strength. Fairy-Stockfish will print a warning if it cannot find the expected NNUE file, but will fall back to classical evaluation.

The NNUE file should be in the same directory as the binary or in the working directory. The expected filename is `nn-46832cfbead3.nnue` (may vary by version -- check the engine's startup output for the expected name).

```bash
# Download from Fishtest (check fairy-stockfish docs for current URL)
cd assets/engines
# Place the .nnue file here
```

### Janggi (Largeboard Variant)

Janggi requires the largeboard build of Fairy-Stockfish because the Janggi board (9x10) exceeds the standard 8x8 limit.

```bash
cd assets/engines

# Download largeboard binary
wget https://github.com/fairy-stockfish/Fairy-Stockfish/releases/download/fairy_sf_14_0_1/fairy-stockfish-largeboard_x86-64-bmi2
mv fairy-stockfish-largeboard_x86-64-bmi2 fairy-stockfish-largeboard
chmod +x fairy-stockfish-largeboard
```

The Janggi NNUE file (`janggi-9991472750de.nnue`) should be placed in `assets/engines/`. Check the Fairy-Stockfish releases or NNUE repository for the correct file.

**Note**: If only one Fairy-Stockfish binary is available with largeboard support, Tess will use it for both chess and Janggi. The server checks for `fairy-stockfish` (chess) and `fairy-stockfish-largeboard` (Janggi) separately.

## KataGo (Go)

KataGo is the strongest open-source Go engine. It requires a binary, a configuration file, and a neural network model.

### Download

**GitHub Releases**: https://github.com/lightvector/KataGo/releases

Choose based on your hardware:
- **CPU only**: `katago-vX.X.X-eigen-linux-x64.zip`
- **CUDA (NVIDIA GPU)**: `katago-vX.X.X-cuda11.1-linux-x64.zip`
- **OpenCL**: `katago-vX.X.X-opencl-linux-x64.zip`

### Linux / WSL2 Setup

```bash
mkdir -p assets/engines/katago
cd assets/engines/katago

# Download and extract (adjust URL for latest release)
wget https://github.com/lightvector/KataGo/releases/download/v1.15.3/katago-v1.15.3-eigen-linux-x64.zip
unzip katago-v1.15.3-eigen-linux-x64.zip
mv katago katago  # or rename as needed
chmod +x katago
```

### Neural Network Model

KataGo needs a neural network model file. Download from the KataGo releases or the KataGo networks page:

**Networks**: https://katagotraining.org/networks/

For a good balance of speed and strength, use a 20-block model. Place it as `default_model.bin.gz`:

```bash
cd assets/engines/katago
wget -O default_model.bin.gz <model-url>
```

### GTP Configuration

Create `assets/engines/katago/default_gtp.cfg` or copy the example config from the KataGo release. Key settings:

```ini
# Logging
logDir = /dev/null
logAllGTPCommunication = false

# Search settings (overridden per-query by Tess)
maxVisits = 500

# Performance
numSearchThreads = 4
numAnalysisThreads = 2

# For GPU acceleration (uncomment for CUDA builds)
# numNNServerThreadsPerModel = 2
# nnCacheSizePowerOfTwo = 22
```

### CUDA (GPU Acceleration)

If you have an NVIDIA GPU:

1. Install CUDA toolkit and cuDNN
2. Download the CUDA build of KataGo
3. Name it `katago-cuda` and place it in `assets/engines/katago/`
4. Tess auto-detects GPU availability via `nvidia-smi` and prefers the CUDA binary

```bash
cd assets/engines/katago
mv katago-v1.15.3-cuda11.1-linux-x64/katago katago-cuda
chmod +x katago-cuda
```

### Verify KataGo

```bash
cd assets/engines/katago
./katago version
./katago gtp -config default_gtp.cfg -model default_model.bin.gz
```

In the GTP session, type `name` and press Enter. You should see `KataGo`. Type `quit` to exit.

## Verification

Run `tess.sh` to verify all engines are detected:

```bash
./tess.sh status
```

Expected output:

```
Tess Status
---------------------
Server:  Not running
Chess:   OK
Go:      OK
Janggi:  OK
Claude:  OK
```

Or run the install check:

```bash
./tess.sh install
```

This will report which engines are found and which are missing.

## Engine Resolution

Engines are stored in `assets/engines/` (gitignored). Run `./scripts/download-engines.sh` to download them automatically.

## Difficulty Calibration

Tess maps 5 difficulty tiers to engine parameters. All tier definitions, ACPL thresholds, and AI targets are derived from a single source of truth: `SKILL_SCALE` in `packages/shared/src/evaluation.ts`.

See `docs/engine-calibration.md` for full calibration methodology and simulation results.

### Chess / Janggi (Fairy-Stockfish)

Uses `UCI_LimitStrength` and `UCI_Elo` for realistic play at each level. Weak moves generated via two-pass MultiPV analysis (50ms shallow search, pick by Elo rank).

| Tier | Chess Elo | Janggi Elo | Description |
|------|-----------|------------|-------------|
| Beginner | ~800 | ~800 | Frequent blunders, misses basic tactics |
| Casual | ~1200 | ~1200 | Knows basics, misses complex tactics |
| Club | ~1600 | ~1600 | Solid club player |
| Pro | ~2200 | ~2200 | Master level |
| Superhuman | ~2800+ | ~2800+ | Full engine strength (no limiting) |

### Go (KataGo)

Uses visit count budgets for AI difficulty. Weak moves generated via low-ranked multi-PV suggestions (all guaranteed legal by KataGo).

| Tier | Visits | Approximate Level |
|------|--------|-------------------|
| Beginner | 10 | ~16+ kyu |
| Casual | 50 | ~13-15 kyu |
| Club | 200 | ~4-8 kyu |
| Pro | 1000 | ~1-3 dan |
| Superhuman | 5000 | 9 dan+ |

Suggestion search always runs at full engine strength regardless of the difficulty tier.

## Troubleshooting

### "Engine not found" error

- Check that the binary exists in `assets/engines/` and has execute permissions (`chmod +x`)
- Run `./tess.sh status` to see which engines are detected

### KataGo crashes on startup

- Verify the model file matches the binary version (CPU model for CPU binary, etc.)
- Check the GTP config file exists and is valid
- For CUDA builds: verify CUDA drivers are installed (`nvidia-smi`)

### Fairy-Stockfish gives wrong NNUE warning

- The NNUE file must be in the same directory as the binary or the server's working directory
- The filename must match exactly what the engine expects (check engine startup output)

### Permission denied on WSL2

WSL2 may not preserve execute permissions from Windows filesystems:

```bash
chmod +x assets/engines/fairy-stockfish
chmod +x assets/engines/fairy-stockfish-largeboard
chmod +x assets/engines/katago/katago
chmod +x assets/engines/katago/katago-cuda
```

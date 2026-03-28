import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../logger.js";

const log = createLogger("engine-resolve");
const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveEnginePath(): string {
	const base = resolve(__dirname, "../../../../assets/engines");
	const boardgamesBase = resolve(__dirname, "../../../../../boardgames/assets/engines");

	const candidates = [resolve(base, "fairy-stockfish"), resolve(boardgamesBase, "fairy-stockfish")];

	for (const p of candidates) {
		if (existsSync(p)) {
			log.info("found engine", { path: p });
			return p;
		}
	}

	throw new Error(
		`Fairy-Stockfish not found. Checked: ${candidates.join(", ")}. Place the binary at assets/engines/fairy-stockfish`,
	);
}

export function resolveNnuePath(): string | null {
	const base = resolve(__dirname, "../../../../assets/engines");
	const boardgamesBase = resolve(__dirname, "../../../../../boardgames/assets/engines");

	const candidates = [
		resolve(base, "nn-46832cfbead3.nnue"),
		resolve(boardgamesBase, "nn-46832cfbead3.nnue"),
	];

	for (const p of candidates) {
		if (existsSync(p)) return p;
	}

	log.warn("NNUE file not found, engine will use default evaluation");
	return null;
}

export function resolveJanggiEnginePath(): string | null {
	const base = resolve(__dirname, "../../../../assets/engines");
	const boardgamesBase = resolve(__dirname, "../../../../../boardgames/assets/engines");

	const candidates = [
		resolve(base, "fairy-stockfish-largeboard"),
		resolve(boardgamesBase, "fairy-stockfish-largeboard"),
		resolve(base, "fairy-stockfish-largeboard_x86-64-bmi2.exe"),
		resolve(boardgamesBase, "fairy-stockfish-largeboard_x86-64-bmi2.exe"),
	];

	for (const p of candidates) {
		if (existsSync(p)) {
			log.info("found Janggi engine", { path: p });
			return p;
		}
	}

	log.warn("Janggi largeboard engine not found");
	return null;
}

export function resolveJanggiNnuePath(): string | null {
	const base = resolve(__dirname, "../../../../assets/engines");
	const boardgamesBase = resolve(__dirname, "../../../../../boardgames/assets/engines");

	const candidates = [
		resolve(base, "janggi-9991472750de.nnue"),
		resolve(boardgamesBase, "janggi-9991472750de.nnue"),
	];

	for (const p of candidates) {
		if (existsSync(p)) return p;
	}
	return null;
}

function hasGpu(): boolean {
	try {
		execSync("nvidia-smi", { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export function resolveKataGoPath(): string | null {
	const base = resolve(__dirname, "../../../../assets/engines/katago");
	const boardgamesBase = resolve(__dirname, "../../../../../boardgames/assets/engines/katago");

	const dirs = [base, boardgamesBase];
	const gpu = hasGpu();

	// Prefer CUDA binary if GPU available
	if (gpu) {
		for (const dir of dirs) {
			const cuda = resolve(dir, "katago-cuda");
			if (existsSync(cuda)) {
				log.info("found KataGo CUDA", { path: cuda });
				return cuda;
			}
		}
	}

	for (const dir of dirs) {
		const binary = resolve(dir, "katago");
		if (existsSync(binary)) {
			log.info("found KataGo CPU", { path: binary });
			return binary;
		}
	}

	log.warn("KataGo not found, Go will not be available");
	return null;
}

export function resolveKataGoConfig(): { config: string; model: string } | null {
	const base = resolve(__dirname, "../../../../assets/engines/katago");
	const boardgamesBase = resolve(__dirname, "../../../../../boardgames/assets/engines/katago");

	const dirs = [base, boardgamesBase];

	for (const dir of dirs) {
		const config = resolve(dir, "default_gtp.cfg");
		const model = resolve(dir, "default_model.bin.gz");
		if (existsSync(config) && existsSync(model)) {
			return { config, model };
		}
	}

	return null;
}

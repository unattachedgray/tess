import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../logger.js";

const log = createLogger("engine-resolve");
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = resolve(__dirname, "../../../../assets/engines");

export function resolveEnginePath(): string {
	const p = resolve(ENGINE_DIR, "fairy-stockfish");
	if (existsSync(p)) {
		log.info("found engine", { path: p });
		return p;
	}
	throw new Error(
		`Fairy-Stockfish not found at ${p}. Run: ./scripts/download-engines.sh`,
	);
}

export function resolveNnuePath(): string | null {
	const p = resolve(ENGINE_DIR, "nn-46832cfbead3.nnue");
	if (existsSync(p)) return p;
	log.warn("NNUE file not found, engine will use default evaluation");
	return null;
}

export function resolveJanggiEnginePath(): string | null {
	for (const name of ["fairy-stockfish-largeboard", "fairy-stockfish-largeboard_x86-64-bmi2.exe"]) {
		const p = resolve(ENGINE_DIR, name);
		if (existsSync(p)) {
			log.info("found Janggi engine", { path: p });
			return p;
		}
	}
	log.warn("Janggi largeboard engine not found");
	return null;
}

export function resolveJanggiNnuePath(): string | null {
	const p = resolve(ENGINE_DIR, "janggi-9991472750de.nnue");
	if (existsSync(p)) return p;
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
	const dir = resolve(ENGINE_DIR, "katago");
	const gpu = hasGpu();

	if (gpu) {
		const cuda = resolve(dir, "katago-cuda");
		if (existsSync(cuda)) {
			log.info("found KataGo CUDA", { path: cuda });
			return cuda;
		}
	}

	const binary = resolve(dir, "katago");
	if (existsSync(binary)) {
		log.info("found KataGo CPU", { path: binary });
		return binary;
	}

	log.warn("KataGo not found, Go will not be available");
	return null;
}

export function resolveKataGoConfig(): { config: string; model: string } | null {
	const dir = resolve(ENGINE_DIR, "katago");
	const config = resolve(dir, "default_gtp.cfg");
	const model = resolve(dir, "default_model.bin.gz");
	if (existsSync(config) && existsSync(model)) {
		return { config, model };
	}
	return null;
}

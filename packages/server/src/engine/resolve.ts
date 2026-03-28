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

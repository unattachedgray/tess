import { type ChildProcess, spawn } from "node:child_process";
import { createLogger } from "../logger.js";

const log = createLogger("uci");

export interface UciSearchResult {
	bestmove: string;
	info: UciInfo[];
}

export interface UciInfo {
	depth: number;
	multipv: number;
	score: number;
	mate: number | null;
	pv: string[];
}

export class UciAdapter {
	private process: ChildProcess | null = null;
	private buffer = "";
	private ready = false;
	private initPromise: Promise<void> | null = null;
	private engineName = "";

	constructor(
		private readonly enginePath: string,
		private readonly options: Record<string, string> = {},
	) {}

	async init(): Promise<void> {
		if (this.initPromise) return this.initPromise;
		this.initPromise = this.doInit();
		return this.initPromise;
	}

	private async doInit(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.process = spawn(this.enginePath, [], { stdio: ["pipe", "pipe", "pipe"] });

			this.process.on("error", (err) => {
				log.error("engine process error", { error: err.message });
				reject(err);
			});

			this.process.on("exit", (code) => {
				log.warn("engine process exited", { code });
				this.ready = false;
				this.initPromise = null;
			});

			this.process.stdout!.on("data", (data: Buffer) => {
				this.buffer += data.toString();
			});

			this.process.stderr!.on("data", (data: Buffer) => {
				log.debug("engine stderr", { data: data.toString().trim() });
			});

			this.send("uci");

			this.waitFor("uciok", 10000)
				.then(() => {
					for (const [name, value] of Object.entries(this.options)) {
						this.send(`setoption name ${name} value ${value}`);
					}
					this.send("isready");
					return this.waitFor("readyok", 10000);
				})
				.then(() => {
					this.ready = true;
					log.info("engine ready", { name: this.engineName });
					resolve();
				})
				.catch(reject);
		});
	}

	async search(fen: string, movetime: number, multiPv = 1): Promise<UciSearchResult> {
		if (!this.ready) throw new Error("Engine not ready");

		this.send(`setoption name MultiPV value ${multiPv}`);
		this.send("isready");
		await this.waitFor("readyok", 5000);

		this.buffer = "";
		this.send(`position fen ${fen}`);
		this.send(`go movetime ${movetime}`);

		const line = await this.waitFor("bestmove", movetime + 10000);
		const bestmove = line.split(" ")[1];

		if (!bestmove || bestmove === "(none)") {
			throw new Error(`Invalid bestmove from engine: ${line}`);
		}

		const infoLines = this.buffer
			.split("\n")
			.filter((l) => l.startsWith("info") && l.includes(" pv "));

		// Keep only the last info line per multipv index (engine overwrites earlier iterations)
		const byPv = new Map<number, string>();
		for (const l of infoLines) {
			const parsed = this.parseInfo(l);
			byPv.set(parsed.multipv, l);
		}

		const info = [...byPv.values()].map((l) => this.parseInfo(l));

		return { bestmove, info };
	}

	async benchmark(durationMs: number): Promise<number> {
		if (!this.ready) throw new Error("Engine not ready");

		this.buffer = "";
		this.send("position startpos");
		this.send(`go movetime ${durationMs}`);

		await this.waitFor("bestmove", durationMs + 10000);

		let maxNps = 0;
		for (const line of this.buffer.split("\n")) {
			const npsMatch = line.match(/\bnps\s+(\d+)/);
			if (npsMatch) {
				maxNps = Math.max(maxNps, Number.parseInt(npsMatch[1], 10));
			}
		}

		return maxNps;
	}

	private parseInfo(line: string): UciInfo {
		const depth = Number.parseInt(line.match(/\bdepth\s+(\d+)/)?.[1] ?? "0", 10);
		const multipv = Number.parseInt(line.match(/\bmultipv\s+(\d+)/)?.[1] ?? "1", 10);

		let score = 0;
		let mate: number | null = null;
		const cpMatch = line.match(/\bscore cp\s+(-?\d+)/);
		const mateMatch = line.match(/\bscore mate\s+(-?\d+)/);
		if (cpMatch) score = Number.parseInt(cpMatch[1], 10);
		if (mateMatch) mate = Number.parseInt(mateMatch[1], 10);

		const pvMatch = line.match(/\bpv\s+(.+)$/);
		const pv = pvMatch ? pvMatch[1].trim().split(/\s+/) : [];

		return { depth, multipv, score, mate, pv };
	}

	private send(cmd: string): void {
		if (!this.process?.stdin?.writable) return;
		this.process.stdin.write(`${cmd}\n`);
	}

	private waitFor(token: string, timeoutMs: number): Promise<string> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`Timeout waiting for ${token}`));
			}, timeoutMs);

			const check = () => {
				const lines = this.buffer.split("\n");
				for (const line of lines) {
					if (line.startsWith(token)) {
						clearTimeout(timer);
						resolve(line);
						return;
					}
					if (token === "uciok" && line.startsWith("id name")) {
						this.engineName = line.replace("id name ", "");
					}
				}
				setTimeout(check, 10);
			};
			check();
		});
	}

	shutdown(): void {
		if (this.process) {
			this.send("quit");
			setTimeout(() => this.process?.kill(), 1000);
			this.process = null;
			this.ready = false;
			this.initPromise = null;
		}
	}
}

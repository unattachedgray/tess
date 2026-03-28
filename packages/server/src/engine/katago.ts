import { type ChildProcess, spawn } from "node:child_process";
import { createLogger } from "../logger.js";

const log = createLogger("katago");

export interface KataGoMoveInfo {
	move: string;
	visits: number;
	winrate: number;
	scoreLead: number;
	order: number;
	pv: string[];
}

interface PendingQuery {
	resolve: (moves: KataGoMoveInfo[]) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class KataGoAdapter {
	private process: ChildProcess | null = null;
	private buffer = "";
	private pending = new Map<string, PendingQuery>();
	private nextId = 1;
	private initPromise: Promise<void> | null = null;
	private restarting = false;

	constructor(
		private readonly enginePath: string,
		private readonly configPath: string,
		private readonly modelPath: string,
		private readonly overrides: Record<string, string> = {},
	) {}

	async init(): Promise<void> {
		if (this.initPromise) return this.initPromise;
		this.initPromise = this.doInit();
		return this.initPromise;
	}

	private async doInit(): Promise<void> {
		const overrideStr = Object.entries(this.overrides)
			.map(([k, v]) => `${k}=${v}`)
			.join(",");

		const args = ["analysis", "-config", this.configPath, "-model", this.modelPath];
		if (overrideStr) args.push("-override-config", overrideStr);

		return new Promise<void>((resolve, reject) => {
			log.info("spawning KataGo", { path: this.enginePath, args });

			this.process = spawn(this.enginePath, args, { stdio: ["pipe", "pipe", "pipe"] });

			this.process.on("error", (err) => {
				log.error("KataGo process error", { error: err.message });
				reject(err);
			});

			this.process.on("exit", (code) => {
				log.warn("KataGo exited", { code });
				this.rejectAllPending(new Error(`KataGo exited with code ${code}`));
				if (!this.restarting) this.scheduleRestart();
			});

			this.process.stdout!.on("data", (data: Buffer) => {
				this.buffer += data.toString();
				this.processBuffer();
			});

			this.process.stderr!.on("data", (data: Buffer) => {
				const msg = data.toString().trim();
				if (msg) log.debug("KataGo stderr", { msg });
			});

			// Wait a moment for startup, then warmup
			setTimeout(async () => {
				try {
					await this.warmup();
					log.info("KataGo ready");
					resolve();
				} catch (err) {
					log.warn("KataGo warmup failed, continuing", {
						error: (err as Error).message,
					});
					resolve(); // Non-fatal
				}
			}, 500);
		});
	}

	private async warmup(): Promise<void> {
		// Use enough visits to force full NN load (1 visit may not trigger it)
		await this.analyze([], "b", 10, 1);
	}

	async analyze(
		moves: [string, string][],
		_turnColor: string,
		maxVisits: number,
		topN: number,
		boardSize = 19,
	): Promise<KataGoMoveInfo[]> {
		if (!this.process) throw new Error("KataGo not initialized");

		const id = `q${this.nextId++}`;
		const query = {
			id,
			moves: moves.map(([c, v]) => [c.toUpperCase(), v.toUpperCase()]),
			rules: "chinese",
			komi: 7.5,
			boardXSize: boardSize,
			boardYSize: boardSize,
			maxVisits,
		};

		return new Promise<KataGoMoveInfo[]>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`KataGo timeout for query ${id}`));
			}, 30000);

			this.pending.set(id, { resolve, reject, timer });
			this.process!.stdin!.write(`${JSON.stringify(query)}\n`);
		}).then((infos) => infos.sort((a, b) => a.order - b.order).slice(0, topN));
	}

	async getMove(
		moves: [string, string][],
		turnColor: string,
		maxVisits: number,
		boardSize = 19,
	): Promise<string> {
		const results = await this.analyze(moves, turnColor, maxVisits, 1, boardSize);
		return results.length > 0 ? results[0].move : "pass";
	}

	async timedBenchmark(durationMs = 2000): Promise<number> {
		// Phase 1: calibration
		const t0 = Date.now();
		const calibResults = await this.analyze([], "b", 500, 1);
		const calibElapsed = Date.now() - t0;
		const roughVps = calibResults.length > 0 ? (calibResults[0].visits / calibElapsed) * 1000 : 100;

		// Phase 2: sized query
		const targetVisits = Math.max(Math.round(roughVps * (durationMs / 1000)), 1000);
		const t1 = Date.now();
		const results = await this.analyze([], "b", targetVisits, 1);
		const elapsed = Date.now() - t1;
		const totalVisits = results.length > 0 ? results[0].visits : 0;

		return Math.round((totalVisits / elapsed) * 1000);
	}

	private processBuffer(): void {
		let idx = this.buffer.indexOf("\n");
		while (idx >= 0) {
			const line = this.buffer.substring(0, idx).trim();
			this.buffer = this.buffer.substring(idx + 1);
			if (!line) continue;

			try {
				const response = JSON.parse(line);
				this.handleResponse(response);
			} catch {
				// Ignore non-JSON lines (startup messages)
			}
			idx = this.buffer.indexOf("\n");
		}
	}

	private handleResponse(response: {
		id: string;
		error?: string;
		moveInfos?: {
			move: string;
			visits: number;
			winrate: number;
			scoreLead: number;
			order: number;
			pv: string[];
		}[];
	}): void {
		const pending = this.pending.get(response.id);
		if (!pending) return;

		clearTimeout(pending.timer);
		this.pending.delete(response.id);

		if (response.error) {
			pending.reject(new Error(response.error));
			return;
		}

		const moveInfos: KataGoMoveInfo[] = (response.moveInfos ?? []).map((m) => ({
			move: m.move,
			visits: m.visits,
			winrate: m.winrate,
			scoreLead: m.scoreLead,
			order: m.order,
			pv: (m.pv ?? []).slice(0, 5),
		}));

		pending.resolve(moveInfos);
	}

	private rejectAllPending(err: Error): void {
		for (const [_id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(err);
		}
		this.pending.clear();
	}

	private scheduleRestart(): void {
		if (this.restarting) return;
		this.restarting = true;
		setTimeout(async () => {
			this.restarting = false;
			this.initPromise = null;
			try {
				await this.init();
			} catch (err) {
				log.error("KataGo restart failed", { error: (err as Error).message });
			}
		}, 2000);
	}

	shutdown(): void {
		this.rejectAllPending(new Error("KataGo shutting down"));
		if (this.process) {
			try {
				this.process.stdin!.write(`${JSON.stringify({ id: "shutdown", action: "terminate" })}\n`);
			} catch {}
			setTimeout(() => {
				this.process?.kill();
				this.process = null;
			}, 1000);
		}
	}
}

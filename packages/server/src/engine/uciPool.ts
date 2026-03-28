import { createLogger } from "../logger.js";
import { UciAdapter, type UciSearchResult } from "./uci.js";

const log = createLogger("uci-pool");

interface QueueItem {
	resolve: (adapter: UciAdapter) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class UciPool {
	private adapters: UciAdapter[] = [];
	private available: UciAdapter[] = [];
	private queue: QueueItem[] = [];
	private initialized = false;

	constructor(
		private readonly enginePath: string,
		private readonly poolSize: number,
		private readonly options: Record<string, string> = {},
	) {}

	async init(): Promise<void> {
		if (this.initialized) return;

		const promises: Promise<void>[] = [];
		for (let i = 0; i < this.poolSize; i++) {
			const adapter = new UciAdapter(this.enginePath, this.options);
			this.adapters.push(adapter);
			promises.push(adapter.init());
		}

		await Promise.all(promises);
		this.available = [...this.adapters];
		this.initialized = true;
		log.info("pool ready", { size: this.poolSize, engine: this.enginePath });
	}

	async search(fen: string, movetime: number, multiPv = 1): Promise<UciSearchResult> {
		const adapter = await this.checkout();
		try {
			return await adapter.search(fen, movetime, multiPv);
		} finally {
			this.release(adapter);
		}
	}

	async benchmark(durationMs: number): Promise<number> {
		const adapter = await this.checkout();
		try {
			return await adapter.benchmark(durationMs);
		} finally {
			this.release(adapter);
		}
	}

	private checkout(): Promise<UciAdapter> {
		const adapter = this.available.pop();
		if (adapter) return Promise.resolve(adapter);

		return new Promise<UciAdapter>((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this.queue.findIndex((q) => q.resolve === resolve);
				if (idx !== -1) this.queue.splice(idx, 1);
				reject(new Error("Engine checkout timeout"));
			}, 30000);

			this.queue.push({ resolve, reject, timer });
		});
	}

	private release(adapter: UciAdapter): void {
		const next = this.queue.shift();
		if (next) {
			clearTimeout(next.timer);
			next.resolve(adapter);
		} else {
			this.available.push(adapter);
		}
	}

	shutdown(): void {
		for (const adapter of this.adapters) {
			adapter.shutdown();
		}
		for (const item of this.queue) {
			clearTimeout(item.timer);
			item.reject(new Error("Pool shutting down"));
		}
		this.adapters = [];
		this.available = [];
		this.queue = [];
		this.initialized = false;
	}
}

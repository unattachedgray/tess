/**
 * Server-authoritative Fischer clock for multiplayer games.
 * Ticks at 100ms resolution. Broadcasts state every second.
 */
export class FischerClock {
	private white: number;  // milliseconds remaining
	private black: number;
	private increment: number;  // milliseconds
	private running: "white" | "black" | null = null;
	private lastTick: number = 0;
	private interval: ReturnType<typeof setInterval> | null = null;
	private onTimeout: (side: "white" | "black") => void;
	private onTick: (state: ClockState) => void;
	private tickCount = 0;

	constructor(
		initialSeconds: number,
		incrementSeconds: number,
		onTimeout: (side: "white" | "black") => void,
		onTick: (state: ClockState) => void,
	) {
		this.white = initialSeconds * 1000;
		this.black = initialSeconds * 1000;
		this.increment = incrementSeconds * 1000;
		this.onTimeout = onTimeout;
		this.onTick = onTick;
	}

	start(side: "white" | "black"): void {
		this.running = side;
		this.lastTick = Date.now();
		this.tickCount = 0;
		if (!this.interval) {
			this.interval = setInterval(() => this.tick(), 100);
		}
	}

	switchSide(): void {
		if (!this.running) return;
		// Add increment to the side that just moved
		this.tick(); // flush pending time
		if (this.running === "white") {
			this.white += this.increment;
		} else {
			this.black += this.increment;
		}
		this.running = this.running === "white" ? "black" : "white";
		this.lastTick = Date.now();
		this.broadcastState();
	}

	pause(): void {
		if (this.running) this.tick(); // flush
		this.running = null;
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	getState(): ClockState {
		return {
			white: Math.max(0, Math.round(this.white / 100) / 10), // seconds with 1 decimal
			black: Math.max(0, Math.round(this.black / 100) / 10),
			running: this.running,
		};
	}

	destroy(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
		this.running = null;
	}

	isUntimed(): boolean {
		return this.white === 0 && this.black === 0 && this.increment === 0;
	}

	private tick(): void {
		if (!this.running) return;
		const now = Date.now();
		const elapsed = now - this.lastTick;
		this.lastTick = now;

		if (this.running === "white") {
			this.white -= elapsed;
		} else {
			this.black -= elapsed;
		}

		// Check timeout
		if (this.white <= 0) {
			this.white = 0;
			this.pause();
			this.onTimeout("white");
			return;
		}
		if (this.black <= 0) {
			this.black = 0;
			this.pause();
			this.onTimeout("black");
			return;
		}

		// Broadcast every ~1 second (every 10 ticks)
		this.tickCount++;
		if (this.tickCount >= 10) {
			this.tickCount = 0;
			this.broadcastState();
		}
	}

	private broadcastState(): void {
		this.onTick(this.getState());
	}
}

export type ClockState = {
	white: number; // seconds remaining
	black: number;
	running: "white" | "black" | null;
};

<script lang="ts">
	let { time, running = false, side }: {
		time: number;
		running: boolean;
		side: "white" | "black";
	} = $props();

	const formatted = $derived.by(() => {
		const t = Math.max(0, time);
		const mins = Math.floor(t / 60);
		const secs = Math.floor(t % 60);
		if (mins >= 60) {
			const hrs = Math.floor(mins / 60);
			const rmins = mins % 60;
			return `${hrs}:${String(rmins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
		}
		return `${mins}:${String(secs).padStart(2, "0")}`;
	});

	const isLow = $derived(time < 30 && time > 0);
	const isCritical = $derived(time < 10 && time > 0);
</script>

<div
	class="clock"
	class:running
	class:low={isLow}
	class:critical={isCritical}
>
	<span class="clock-time">{formatted}</span>
</div>

<style>
	.clock {
		padding: 4px 10px;
		border-radius: 8px;
		font-family: "SF Mono", "Cascadia Mono", "Fira Code", monospace;
		font-size: 14px;
		font-weight: 700;
		color: var(--text-secondary);
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		transition: all 0.3s;
		min-width: 64px;
		text-align: center;
	}

	.clock.running {
		color: var(--text-primary);
		background: var(--bg-hover);
		border-color: var(--accent);
	}

	.clock.low {
		color: var(--warning);
		border-color: var(--warning);
	}

	.clock.critical {
		color: var(--danger);
		border-color: var(--danger);
		animation: clock-pulse 1s ease-in-out infinite;
	}

	@keyframes clock-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}
</style>

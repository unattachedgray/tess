<script lang="ts">
	let { score, orientation }: { score: number; orientation: "white" | "black" } = $props();

	const whitePercent = $derived.by(() => {
		const cp = Math.max(-1000, Math.min(1000, score));
		const pct = 50 + 50 * (2 / (1 + Math.exp(-cp / 200)) - 1);
		return Math.max(5, Math.min(95, pct));
	});

	const displayPercent = $derived(
		orientation === "white" ? whitePercent : 100 - whitePercent,
	);

	const scoreText = $derived.by(() => {
		const abs = Math.abs(score);
		if (abs > 9000) return `M${abs - 9000}`;
		const pawns = (score / 100).toFixed(1);
		return score > 0 ? `+${pawns}` : pawns;
	});

	const isWinning = $derived(
		(orientation === "white" && score > 0) || (orientation === "black" && score < 0)
	);
</script>

<div class="eval-bar" title="Evaluation: {scoreText}">
	<div class="eval-fill" style="height: {displayPercent}%"></div>
	<div class="eval-label" class:winning={isWinning}>
		{scoreText}
	</div>
</div>

<style>
	.eval-bar {
		width: 32px;
		height: 100%;
		background: #1a1a2e;
		border-radius: 6px;
		position: relative;
		overflow: hidden;
		flex-shrink: 0;
		border: 1px solid var(--border);
	}

	.eval-fill {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: linear-gradient(to top, #e8e8e8 0%, #d4d4d8 100%);
		transition: height 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.eval-label {
		position: absolute;
		bottom: 6px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 10px;
		font-weight: 700;
		font-family: "SF Mono", "Cascadia Mono", "Fira Code", monospace;
		color: var(--text-muted);
		white-space: nowrap;
		z-index: 1;
		writing-mode: vertical-rl;
		text-orientation: mixed;
		letter-spacing: 0.02em;
	}

	.eval-label.winning {
		color: var(--accent);
	}

	@media (max-width: 768px) {
		.eval-bar {
			display: none;
		}
	}
</style>

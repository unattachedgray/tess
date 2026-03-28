<script lang="ts">
	let { score, orientation }: { score: number; orientation: "white" | "black" } = $props();

	// Convert centipawn score to a percentage (50% = even)
	const whitePercent = $derived.by(() => {
		const cp = Math.max(-1000, Math.min(1000, score));
		// Sigmoid-like curve: maps cp to 10%-90% range
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
</script>

<div class="eval-bar" title="Evaluation: {scoreText}">
	<div
		class="eval-fill"
		style="height: {displayPercent}%"
	></div>
	<span class="eval-text">{scoreText}</span>
</div>

<style>
	.eval-bar {
		width: 24px;
		height: 100%;
		background: #333;
		border-radius: 4px;
		position: relative;
		overflow: hidden;
		flex-shrink: 0;
	}

	.eval-fill {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: #e8e8e8;
		transition: height 0.5s ease;
	}

	.eval-text {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 9px;
		font-weight: 700;
		color: #999;
		writing-mode: vertical-rl;
		text-orientation: mixed;
		white-space: nowrap;
		z-index: 1;
		mix-blend-mode: difference;
	}
</style>

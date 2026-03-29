<script lang="ts">
	const PIECE_SYMBOLS: Record<string, string> = {
		k: "\u2654", K: "\u265A",
		q: "\u2655", Q: "\u265B",
		r: "\u2656", R: "\u265C",
		b: "\u2657", B: "\u265D",
		n: "\u2658", N: "\u265E",
		p: "\u2659", P: "\u265F",
	};

	const PIECE_VALUES: Record<string, number> = {
		q: 9, r: 5, b: 3, n: 3, p: 1,
	};

	let { pieces, color }: { pieces: string[]; color: "white" | "black" } = $props();

	const sortedPieces = $derived(
		[...pieces].sort((a, b) => {
			const order = "qrbnp";
			return order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase());
		}),
	);

	const materialValue = $derived(
		pieces.reduce((sum, p) => sum + (PIECE_VALUES[p.toLowerCase()] ?? 0), 0)
	);
</script>

<div class="flex items-center gap-1 h-7 px-1">
	<div class="flex items-center gap-px text-xl">
		{#each sortedPieces as piece}
			<span class="opacity-80">{PIECE_SYMBOLS[color === 'white' ? piece.toUpperCase() : piece.toLowerCase()] ?? piece}</span>
		{/each}
	</div>
	{#if materialValue > 0}
		<span class="text-xs font-bold font-mono text-[var(--accent)]">+{materialValue}</span>
	{/if}
</div>

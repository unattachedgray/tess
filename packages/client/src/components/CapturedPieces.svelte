<script lang="ts">
	const PIECE_SYMBOLS: Record<string, string> = {
		k: "\u2654", K: "\u265A",
		q: "\u2655", Q: "\u265B",
		r: "\u2656", R: "\u265C",
		b: "\u2657", B: "\u265D",
		n: "\u2658", N: "\u265E",
		p: "\u2659", P: "\u265F",
	};

	let { pieces, color }: { pieces: string[]; color: "white" | "black" } = $props();

	const sortedPieces = $derived(
		[...pieces].sort((a, b) => {
			const order = "qrbnp";
			return order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase());
		}),
	);
</script>

<div class="flex items-center gap-0.5 h-6 px-1 text-lg">
	{#each sortedPieces as piece}
		<span class="opacity-70">{PIECE_SYMBOLS[color === 'white' ? piece.toUpperCase() : piece.toLowerCase()] ?? piece}</span>
	{/each}
</div>

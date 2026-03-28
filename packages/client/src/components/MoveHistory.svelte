<script lang="ts">
	let { moves }: { moves: { san: string; moveNumber: number }[] } = $props();

	// Group moves into pairs (white, black)
	const movePairs = $derived.by(() => {
		const pairs: { number: number; white?: string; black?: string }[] = [];
		for (let i = 0; i < moves.length; i += 2) {
			pairs.push({
				number: Math.floor(i / 2) + 1,
				white: moves[i]?.san,
				black: moves[i + 1]?.san,
			});
		}
		return pairs;
	});

	let scrollContainer: HTMLElement;

	$effect(() => {
		if (moves.length && scrollContainer) {
			scrollContainer.scrollTop = scrollContainer.scrollHeight;
		}
	});
</script>

<div class="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden">
	<div class="px-4 py-2 border-b border-[var(--border)]">
		<h3 class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Moves</h3>
	</div>

	<div bind:this={scrollContainer} class="max-h-64 overflow-y-auto p-2">
		{#if movePairs.length === 0}
			<p class="text-sm text-[var(--text-muted)] text-center py-4">No moves yet</p>
		{:else}
			<div class="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-0.5 text-sm">
				{#each movePairs as pair}
					<span class="text-[var(--text-muted)] text-right">{pair.number}.</span>
					<span class="font-mono text-[var(--text-primary)] px-1 rounded hover:bg-[var(--bg-hover)]">
						{pair.white ?? ""}
					</span>
					<span class="font-mono text-[var(--text-primary)] px-1 rounded hover:bg-[var(--bg-hover)]">
						{pair.black ?? ""}
					</span>
				{/each}
			</div>
		{/if}
	</div>
</div>

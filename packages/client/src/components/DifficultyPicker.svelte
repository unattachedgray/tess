<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import type { DifficultyId } from "@tess/shared";

	let { difficulties }: {
		difficulties: { id: DifficultyId; label: string; description: string }[];
	} = $props();
</script>

<div class="space-y-3">
	<h2 class="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">Difficulty</h2>
	<div class="space-y-1.5">
		{#each difficulties as d}
			<button
				class="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm transition-all {appState.difficulty === d.id
					? 'bg-[var(--accent-glow)] border border-[var(--accent)] text-[var(--accent)]'
					: 'bg-[var(--bg-secondary)] border border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
				onclick={() => appState.setDifficulty(d.id)}
			>
				<span class="font-medium">{d.label}</span>
				<span class="text-xs text-[var(--text-muted)]">{d.description}</span>
			</button>
		{/each}
	</div>
</div>

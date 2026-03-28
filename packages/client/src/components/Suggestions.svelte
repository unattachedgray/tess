<script lang="ts">
	import type { Suggestion } from "@tess/shared";
	import type { MoveQuality } from "../lib/stores.svelte.ts";

	let {
		suggestions,
		stale = false,
		moveQuality = null,
		onHoverMove,
		onClearHover,
		onPlayMove,
	}: {
		suggestions: Suggestion[];
		stale: boolean;
		moveQuality: MoveQuality;
		onHoverMove?: (move: string) => void;
		onClearHover?: () => void;
		onPlayMove?: (move: string) => void;
	} = $props();

	const QUALITY_COLORS: Record<string, string> = {
		best: "text-[var(--success)]",
		good: "text-blue-400",
		ok: "text-[var(--text-secondary)]",
		inaccuracy: "text-yellow-400",
		mistake: "text-orange-400",
		blunder: "text-[var(--danger)]",
	};

	const QUALITY_LABELS: Record<string, string> = {
		best: "Best move",
		good: "Good move",
		ok: "OK",
		inaccuracy: "Inaccuracy",
		mistake: "Mistake",
		blunder: "Blunder",
	};

	function formatScore(s: Suggestion): string {
		if (Math.abs(s.score) > 9000) {
			const mate = Math.abs(s.score) - 9000;
			return s.score > 0 ? `M${mate}` : `-M${mate}`;
		}
		const pawns = (s.score / 100).toFixed(1);
		return s.score > 0 ? `+${pawns}` : pawns;
	}
</script>

<div class="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden {stale ? 'opacity-50' : ''} flex-shrink-0">
	<div class="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
		<h3 class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
			Engine
			{#if stale && suggestions.length > 0}
				<span class="inline-flex gap-0.5 ml-1 align-middle">
					<span class="w-1 h-1 rounded-full bg-[var(--accent)] animate-bounce inline-block" style="animation-delay: 0ms"></span>
					<span class="w-1 h-1 rounded-full bg-[var(--accent)] animate-bounce inline-block" style="animation-delay: 150ms"></span>
					<span class="w-1 h-1 rounded-full bg-[var(--accent)] animate-bounce inline-block" style="animation-delay: 300ms"></span>
				</span>
			{/if}
		</h3>
		{#if moveQuality}
			<span class="text-xs font-semibold {QUALITY_COLORS[moveQuality]}">
				{QUALITY_LABELS[moveQuality]}
			</span>
		{/if}
	</div>

	<div class="p-2 space-y-0.5">
		{#if suggestions.length === 0}
			<div class="flex items-center justify-center py-3">
				<div class="flex gap-1">
					<div class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style="animation-delay: 0ms"></div>
					<div class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style="animation-delay: 150ms"></div>
					<div class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style="animation-delay: 300ms"></div>
				</div>
			</div>
		{:else}
			{#each suggestions as sug, i}
				<button
					class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-[var(--bg-hover)] text-left cursor-pointer"
					onmouseenter={() => onHoverMove?.(sug.move)}
					onmouseleave={() => onClearHover?.()}
					onclick={() => onPlayMove?.(sug.move)}
					title="Click to play {sug.san ?? sug.move}"
				>
					<span class="w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0 {i === 0
						? 'bg-[var(--accent)] text-[var(--bg-primary)]'
						: 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}">
						{i + 1}
					</span>
					<span class="font-mono font-semibold text-[var(--text-primary)]">
						{sug.san ?? sug.move}
					</span>
					<span class="ml-auto font-mono text-xs flex-shrink-0 {sug.score > 0 ? 'text-[var(--success)]' : sug.score < 0 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}">
						{formatScore(sug)}
					</span>
				</button>
			{/each}
		{/if}
	</div>
</div>

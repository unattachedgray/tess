<script lang="ts">
	import type { AnalysisMessage } from "../lib/stores.svelte.ts";

	let {
		messages,
		loading = false,
	}: {
		messages: AnalysisMessage[];
		loading: boolean;
	} = $props();

	let scrollContainer: HTMLElement;
	let prevMessageCount = 0;

	// Only auto-scroll when a NEW analysis message arrives, not on other updates
	$effect(() => {
		const count = messages.length;
		if (count > prevMessageCount && scrollContainer) {
			requestAnimationFrame(() => {
				scrollContainer.scrollTop = scrollContainer.scrollHeight;
			});
		}
		prevMessageCount = count;
	});

	function renderMarkdown(text: string): string {
		return text
			.replace(/\*\*(.+?)\*\*/g, '<strong class="text-[var(--accent)]">$1</strong>')
			.replace(/\*(.+?)\*/g, "<em>$1</em>")
			.replace(/^### (.+)$/gm, '<h4 class="text-sm font-semibold mt-2 mb-1">$1</h4>')
			.replace(/^## (.+)$/gm, '<h3 class="text-sm font-bold mt-2 mb-1">$1</h3>')
			.replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
			.replace(/\n{2,}/g, "</p><p>")
			.replace(/\n/g, "<br>");
	}
</script>

<div class="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden flex flex-col min-h-0 flex-1">
	<div class="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] flex-shrink-0">
		<h3 class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
			AI Coach
		</h3>
		{#if loading}
			<span class="inline-block w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"></span>
		{/if}
	</div>

	<div bind:this={scrollContainer} class="flex-1 overflow-y-auto p-3 space-y-3">
		{#if messages.length === 0 && !loading}
			<p class="text-sm text-[var(--text-muted)] text-center py-4">
				Make a move to get coaching feedback
			</p>
		{/if}

		{#each messages as msg}
			<div class="analysis-entry">
				<div class="flex items-center gap-2 mb-1">
					<span class="text-[10px] font-medium text-[var(--text-muted)] uppercase">
						Move {msg.moveNumber}
					</span>
				</div>
				<div class="text-sm text-[var(--text-secondary)] leading-relaxed analysis-content">
					{@html renderMarkdown(msg.text)}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.analysis-entry + .analysis-entry {
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}

	.analysis-content :global(strong) {
		cursor: help;
	}
</style>

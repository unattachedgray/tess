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

	$effect(() => {
		if (messages.length && scrollContainer) {
			scrollContainer.scrollTop = scrollContainer.scrollHeight;
		}
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

<div class="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden flex flex-col max-h-80">
	<div class="px-4 py-2 border-b border-[var(--border)]">
		<h3 class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
			AI Coach
		</h3>
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

		{#if loading}
			<div class="flex items-center gap-2 py-2">
				<div class="flex gap-1">
					<div class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style="animation-delay: 0ms"></div>
					<div class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style="animation-delay: 150ms"></div>
					<div class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style="animation-delay: 300ms"></div>
				</div>
				<span class="text-xs text-[var(--text-muted)]">Analyzing...</span>
			</div>
		{/if}
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

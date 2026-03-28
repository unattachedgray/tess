<script lang="ts">
	import type { AnalysisMessage } from "../lib/stores.svelte.ts";

	let {
		messages,
		loading = false,
		currentMoveNumber = 0,
	}: {
		messages: AnalysisMessage[];
		loading: boolean;
		currentMoveNumber: number;
	} = $props();

	// Sort by move number descending — highest move number first (most relevant)
	const sorted = $derived(
		[...messages].sort((a, b) => b.moveNumber - a.moveNumber),
	);

	function renderMarkdown(text: string): string {
		// First pass: extract **Terms** / **Tooltips** section and build a lookup
		const termDefs = new Map<string, string>();
		const termsMatch = text.match(/\*\*(?:Terms|Tooltips|Key Terms)\*\*\s*\n([\s\S]*?)$/i);
		if (termsMatch) {
			const lines = termsMatch[1].split("\n");
			for (const line of lines) {
				const m = line.match(/^[-*]\s*\*\*(.+?)\*\*\s*[—–-]\s*(.+)/);
				if (m) termDefs.set(m[1].toLowerCase(), m[2].trim());
			}
		}

		// Second pass: render markdown and add tooltips to bolded terms
		let html = text
			// Remove the Terms section from display
			.replace(/\*\*(?:Terms|Tooltips|Key Terms)\*\*\s*\n[\s\S]*$/i, "")
			.trim()
			.replace(/\*\*(.+?)\*\*/g, (_match, term) => {
				const def = termDefs.get(term.toLowerCase());
				if (def) {
					return `<span class="glossary-term" data-tooltip="${def.replace(/"/g, '&quot;')}"><strong>${term}</strong></span>`;
				}
				return `<strong>${term}</strong>`;
			})
			.replace(/\*(.+?)\*/g, "<em>$1</em>")
			.replace(/^### (.+)$/gm, '<h4 class="text-sm font-semibold mt-2 mb-1">$1</h4>')
			.replace(/^## (.+)$/gm, '<h3 class="text-sm font-bold mt-2 mb-1">$1</h3>')
			.replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
			.replace(/\n{2,}/g, "</p><p>")
			.replace(/\n/g, "<br>");

		return html;
	}
</script>

<div class="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden flex flex-col min-h-0 flex-1">
	<div class="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] flex-shrink-0">
		<h3 class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
			AI Coach
		</h3>
		{#if loading}
			<div class="flex gap-1 ml-1">
				<div class="w-1 h-1 rounded-full bg-[var(--accent)] animate-bounce" style="animation-delay: 0ms"></div>
				<div class="w-1 h-1 rounded-full bg-[var(--accent)] animate-bounce" style="animation-delay: 150ms"></div>
				<div class="w-1 h-1 rounded-full bg-[var(--accent)] animate-bounce" style="animation-delay: 300ms"></div>
			</div>
		{/if}
	</div>

	<div class="flex-1 overflow-y-auto p-3 space-y-3">
		{#if messages.length === 0 && !loading}
			<p class="text-sm text-[var(--text-muted)] text-center py-4">
				Make a move to get coaching feedback
			</p>
		{/if}

		{#each sorted as msg, i}
			{@const isCurrent = msg.moveNumber >= currentMoveNumber - 1}
			<div class="analysis-entry {isCurrent ? 'latest' : 'older'}">
				<div class="flex items-center gap-2 mb-1">
					<span class="text-[10px] font-medium {isCurrent ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} uppercase">
						After move {msg.moveNumber}
						{#if msg.moveNumber < currentMoveNumber - 2}
							<span class="text-[var(--text-muted)]">(earlier)</span>
						{/if}
					</span>
				</div>
				<div class="text-sm leading-relaxed analysis-content {isCurrent ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}">
					{@html renderMarkdown(msg.text)}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.analysis-entry.older {
		opacity: 0.6;
	}

	.analysis-entry + .analysis-entry {
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}

	.analysis-content :global(.glossary-term) {
		color: var(--accent);
		cursor: help;
		position: relative;
		border-bottom: 1px dotted var(--accent);
	}

	.analysis-content :global(.glossary-term:hover::after) {
		content: attr(data-tooltip);
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--bg-primary);
		color: var(--text-primary);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 10px;
		font-size: 12px;
		font-weight: 400;
		line-height: 1.4;
		white-space: normal;
		width: max-content;
		max-width: 260px;
		z-index: 50;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		pointer-events: none;
	}

	.analysis-content :global(.glossary-term:hover::before) {
		content: "";
		position: absolute;
		bottom: calc(100% + 2px);
		left: 50%;
		transform: translateX(-50%);
		border: 4px solid transparent;
		border-top-color: var(--border);
		z-index: 50;
	}

	.analysis-content :global(strong) {
		color: var(--accent);
	}
</style>

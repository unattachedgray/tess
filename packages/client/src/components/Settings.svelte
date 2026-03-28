<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import type { WsClient } from "../lib/ws.ts";

	let { ws }: { ws: WsClient } = $props();
	let open = $state(false);

	function toggleCoaching() {
		appState.setCoaching(!appState.coachingEnabled);
		ws.send({ type: "SET_COACHING", enabled: appState.coachingEnabled });
	}

	function setSuggestions(n: number) {
		appState.setSuggestionCount(n);
		ws.send({ type: "SET_SUGGESTIONS", count: n });
	}

	function setStrength(s: "fast" | "balanced" | "deep") {
		appState.setSuggestionStrength(s);
		// Will apply on next suggestion request
	}
</script>

<div class="relative">
	<button
		class="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
		onclick={() => open = !open}
	>
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
			<circle cx="8" cy="8" r="2.5" />
			<path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
		</svg>
	</button>

	{#if open}
		<!-- Backdrop -->
		<div class="fixed inset-0 z-40" onclick={() => open = false} role="presentation"></div>

		<!-- Dropdown -->
		<div class="absolute right-0 top-8 z-50 w-56 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] shadow-xl p-3 space-y-3">
			<!-- Suggestions count -->
			<div class="space-y-1.5">
				<label class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Suggestions</label>
				<div class="flex gap-1">
					{#each [0, 1, 2, 3] as n}
						<button
							class="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all {appState.suggestionCount === n
								? 'bg-[var(--accent)] text-[var(--bg-primary)]'
								: 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
							onclick={() => setSuggestions(n)}
						>
							{n}
						</button>
					{/each}
				</div>
			</div>

			<!-- Suggestion strength -->
			<div class="space-y-1.5">
				<label class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Analysis depth</label>
				<div class="flex gap-1">
					{#each [["fast", "Fast"], ["balanced", "Mid"], ["deep", "Deep"]] as [val, label]}
						<button
							class="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all {appState.suggestionStrength === val
								? 'bg-[var(--accent)] text-[var(--bg-primary)]'
								: 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
							onclick={() => setStrength(val as "fast" | "balanced" | "deep")}
						>
							{label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Coaching toggle -->
			<div class="flex items-center justify-between">
				<label class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">AI Coach</label>
				<button
					class="w-10 h-5 rounded-full transition-colors relative {appState.coachingEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-hover)]'}"
					onclick={toggleCoaching}
				>
					<div class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform {appState.coachingEnabled ? 'translate-x-5' : 'translate-x-0.5'}"></div>
				</button>
			</div>
		</div>
	{/if}
</div>

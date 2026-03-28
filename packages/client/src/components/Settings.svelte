<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import { LANGUAGES, type Language } from "../lib/i18n.ts";
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
	}

	function toggleAutoplay() {
		appState.autoplayActive = !appState.autoplayActive;
		ws.send({
			type: "AUTOPLAY",
			enabled: appState.autoplayActive,
			humanElo: appState.autoplayHumanElo,
		});
	}

	function setHumanElo(elo: number) {
		appState.setAutoplayHumanElo(elo);
	}

	function changeLanguage(lang: Language) {
		appState.setLanguage(lang);
	}

	const ELO_PRESETS = [
		{ elo: 800, label: "800" },
		{ elo: 1200, label: "1200" },
		{ elo: 1600, label: "1600" },
		{ elo: 2200, label: "2200" },
	];
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
				<span class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Suggestions</span>
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
				<span class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Analysis depth</span>
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
				<span class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">AI Coach</span>
				<button
					class="w-10 h-5 rounded-full transition-colors relative {appState.coachingEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-hover)]'}"
					onclick={toggleCoaching}
					aria-label="Toggle AI Coach"
				>
					<div class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform {appState.coachingEnabled ? 'translate-x-5' : 'translate-x-0.5'}"></div>
				</button>
			</div>

			<!-- Language -->
			<div class="space-y-1.5">
				<span class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Language</span>
				<select
					class="w-full py-1.5 px-2 rounded-lg text-xs bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border)]"
					onchange={(e) => changeLanguage((e.target as HTMLSelectElement).value as Language)}
					value={appState.language}
				>
					{#each LANGUAGES as lang}
						<option value={lang.code}>{lang.name}</option>
					{/each}
				</select>
			</div>

			<!-- Autoplay -->
			<div class="space-y-1.5 pt-2 border-t border-[var(--border)]">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Autoplay</span>
					<button
						class="w-10 h-5 rounded-full transition-colors relative {appState.autoplayActive ? 'bg-[var(--success)]' : 'bg-[var(--bg-hover)]'}"
						onclick={toggleAutoplay}
						aria-label="Toggle Autoplay"
					>
						<div class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform {appState.autoplayActive ? 'translate-x-5' : 'translate-x-0.5'}"></div>
					</button>
				</div>
				{#if appState.autoplayActive || true}
					<div class="space-y-1">
						<span class="text-[10px] text-[var(--text-muted)]">Human player Elo</span>
						<div class="flex gap-1">
							{#each ELO_PRESETS as { elo, label }}
								<button
									class="flex-1 py-1 rounded-lg text-[10px] font-medium transition-all {appState.autoplayHumanElo === elo
										? 'bg-[var(--accent)] text-[var(--bg-primary)]'
										: 'bg-[var(--bg-hover)] text-[var(--text-secondary)]'}"
									onclick={() => setHumanElo(elo)}
								>
									{label}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

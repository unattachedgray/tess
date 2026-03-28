<script lang="ts">
	import { appState } from "./lib/stores.svelte.ts";
	import { WsClient } from "./lib/ws.ts";
	import Home from "./views/Home.svelte";
	import Game from "./views/Game.svelte";

	const ws = new WsClient();

	$effect(() => {
		ws.connect();
		return () => ws.disconnect();
	});

	const GAME_NAMES: Record<string, string> = {
		chess: "Chess",
		go: "Go",
		janggi: "Janggi",
	};

	function goHome() {
		appState.view = "home";
		appState.reset();
	}
</script>

<div class="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
	<header class="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] h-[44px]">
		{#if appState.view === 'game' && appState.gameId}
			<!-- Game header: back button + game info -->
			<button
				class="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
				onclick={goHome}
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M10 12L6 8L10 4" />
				</svg>
				Menu
			</button>

			<span class="text-sm font-medium text-[var(--text-primary)]">
				{GAME_NAMES[appState.gameType] ?? appState.gameType}
			</span>

			<span class="text-xs text-[var(--text-muted)] capitalize">
				{appState.difficulty}
			</span>
		{:else}
			<!-- Home header -->
			<span class="text-lg font-bold tracking-tight text-[var(--accent)]">Tess</span>
			<span></span>
			<span></span>
		{/if}
	</header>

	<main class="flex-1">
		{#if appState.view === 'home'}
			<Home {ws} />
		{:else if appState.view === 'game'}
			<Game {ws} />
		{/if}
	</main>
</div>

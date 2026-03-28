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

	let showMenu = $state(false);

	const GAME_NAMES: Record<string, string> = {
		chess: "Chess",
		go: "Go",
		janggi: "Janggi",
	};

	function toggleMenu() {
		showMenu = !showMenu;
	}
</script>

<div class="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
	<header class="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] h-[44px]">
		{#if appState.view === 'game' && appState.gameId}
			<button
				class="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
				onclick={toggleMenu}
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
					{#if showMenu}
						<path d="M4 4L12 12M12 4L4 12" />
					{:else}
						<path d="M2 4H14M2 8H14M2 12H14" />
					{/if}
				</svg>
				{showMenu ? 'Close' : 'Menu'}
			</button>

			<span class="text-sm font-medium text-[var(--text-primary)]">
				{GAME_NAMES[appState.gameType] ?? appState.gameType}
			</span>

			<span class="text-xs text-[var(--text-muted)] capitalize">
				{appState.difficulty}
			</span>
		{:else}
			<span class="text-lg font-bold tracking-tight text-[var(--accent)]">Tess</span>
			<span></span>
			<span></span>
		{/if}
	</header>

	<main class="flex-1 relative">
		{#if appState.view === 'home' || (showMenu && appState.view === 'game')}
			<!-- Menu overlay (or full page on home) -->
			<div class={appState.view === 'game' ? 'absolute inset-0 z-50 bg-[var(--bg-primary)]/95 backdrop-blur-sm overflow-y-auto' : ''}>
				<Home {ws} onStart={() => showMenu = false} />
			</div>
		{/if}

		{#if appState.view === 'game'}
			<Game {ws} />
		{/if}
	</main>
</div>

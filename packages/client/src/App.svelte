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
</script>

<div class="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
	<header class="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
		<button
			class="text-xl font-bold tracking-tight text-[var(--accent)] hover:opacity-80 transition-opacity"
			onclick={() => { appState.view = 'home'; appState.reset(); }}
		>
			Tess
		</button>

		{#if appState.view === 'game' && appState.gameId}
			<div class="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
				<span class="capitalize">{appState.gameType}</span>
				<span class="text-[var(--text-muted)]">|</span>
				<span class="capitalize">{appState.difficulty}</span>
			</div>
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

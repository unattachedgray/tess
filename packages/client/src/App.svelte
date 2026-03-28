<script lang="ts">
	import { appState } from "./lib/stores.svelte.ts";
	import { WsClient } from "./lib/ws.ts";
	import { t } from "./lib/i18n.ts";
	import Home from "./views/Home.svelte";
	import Game from "./views/Game.svelte";
	import Review from "./views/Review.svelte";
	import Settings from "./components/Settings.svelte";

	const ws = new WsClient();

	$effect(() => {
		ws.connect();
		return () => ws.disconnect();
	});

	let showMenu = $state(false);

	// Reactive translation — re-evaluates when language changes
	const tt = (key: string) => t(key, appState.language);

	const gameName = $derived(tt(`game.${appState.gameType}`));

	// Auto-start: register handlers and send NEW_GAME on first connect
	let autoStarted = $state(false);

	function setupHandlers() {
		ws.clearHandlers();

		ws.on("GAME_STATE", (msg) => {
			appState.updateFromGameState(msg);
			appState.view = "game";
		});
		ws.on("MOVE", (msg) => appState.updateFromMove(msg));
		ws.on("GAME_OVER", (msg) => { appState.isGameOver = true; appState.result = msg.result; });
		ws.on("SUGGESTIONS", (msg) => appState.updateSuggestions(msg.suggestions));
		ws.on("ANALYSIS", (msg) => {
			const data = msg as any;
			if (data.gameId && data.gameId !== appState.gameId) return;
			appState.addAnalysis(data.text, data.moveNumber);
		});
		ws.on("MOVE_QUALITY", (msg) => { appState.lastMoveQuality = (msg as any).quality; });
		ws.on("HINT", (msg) => { appState.hintLevel = msg.level; });
		ws.on("SKILL_EVAL", (msg) => { appState.skillEval = msg as any; });
		ws.on("GAME_SUMMARY", (msg) => { appState.gameSummary = (msg as any).text; });
		ws.on("PLAYER_COUNT", (msg) => { appState.playerCounts = msg as any; });
		ws.on("ERROR", (msg) => { console.error("[game]", (msg as any).message); });
	}

	function startNewGame() {
		appState.reset();
		setupHandlers();
		ws.send({
			type: "NEW_GAME",
			gameType: appState.gameType,
			difficulty: appState.difficulty,
			playerColor: appState.playerColor,
			coaching: appState.coachingEnabled,
			suggestionCount: appState.suggestionCount,
			suggestionStrength: appState.suggestionStrength,
			language: appState.language,
		});
		showMenu = false;
	}

	// Auto-start: set up handlers immediately, send NEW_GAME (WS queues if not yet connected)
	$effect(() => {
		if (!autoStarted) {
			autoStarted = true;
			setupHandlers();
			ws.send({
				type: "NEW_GAME",
				gameType: appState.gameType,
				difficulty: appState.difficulty,
				playerColor: appState.playerColor,
				coaching: appState.coachingEnabled,
				suggestionCount: appState.suggestionCount,
				suggestionStrength: appState.suggestionStrength,
			language: appState.language,
			});
		}
	});
</script>

<div class="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
	<header class="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] h-[44px]">
		<button
			class="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
			onclick={() => { if (appState.view === 'review') { appState.view = 'game'; } else { showMenu = !showMenu; } }}
		>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
				{#if showMenu}
					<path d="M4 4L12 12M12 4L4 12" />
				{:else}
					<path d="M2 4H14M2 8H14M2 12H14" />
				{/if}
			</svg>
			{#if appState.view === 'review'}
				{tt('header.back')}
			{:else}
				{showMenu ? tt('header.close') : gameName}
			{/if}
		</button>

		<div class="flex items-center gap-3">
			<span class="text-sm font-bold tracking-tight text-[var(--accent)]">Chess Chess Tess</span>
			{#if appState.playerCounts.total > 0}
				<span class="text-[10px] text-[var(--text-muted)]" title="Players online: {appState.playerCounts.chess} chess, {appState.playerCounts.go} go, {appState.playerCounts.janggi} janggi">
					{appState.playerCounts.total} online
				</span>
			{/if}
		</div>

		<div class="flex items-center gap-3">
			<span class="text-xs text-[var(--text-muted)]" title="Your ID">{appState.userId}</span>
			<Settings {ws} />
		</div>
	</header>

	<main class="flex-1 relative">
		{#if showMenu}
			<div
				class="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto flex items-start justify-center pt-8 pb-8"
				onclick={(e) => { if (e.target === e.currentTarget) showMenu = false; }}
				onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') showMenu = false; }}
				role="dialog"
			>
				<div class="bg-[var(--bg-primary)] rounded-2xl border border-[var(--border)] shadow-2xl w-full max-w-md mx-4 p-6" onclick={(e) => e.stopPropagation()}>
					<Home {ws} onStart={startNewGame} compact />
				</div>
			</div>
		{/if}

		{#if appState.view === 'review'}
			<Review
				moves={appState.reviewMoves}
				accuracy={appState.skillEval?.accuracy}
				skillLabel={appState.skillEval?.skill.label}
				gameSummary={appState.gameSummary ?? undefined}
			/>
		{:else}
			<Game {ws} />
		{/if}
	</main>
</div>

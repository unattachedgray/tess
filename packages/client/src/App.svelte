<script lang="ts">
	import { appState } from "./lib/stores.svelte.ts";
	import { WsClient } from "./lib/ws.ts";
	import { t } from "./lib/i18n.ts";
	import Home from "./views/Home.svelte";
	import Game from "./views/Game.svelte";
	import Review from "./views/Review.svelte";
	import Lobby from "./views/Lobby.svelte";
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
			const wasMp = appState.isMultiplayer;
			const wasOpponent = appState.opponentName;
			appState.updateFromGameState(msg);
			appState.view = "game";
			// Preserve multiplayer state (GAME_STATE arrives after MP_GAME_START)
			if (wasMp) {
				appState.isMultiplayer = true;
				appState.opponentName = wasOpponent;
				// Request suggestions if it's our turn at game start
				if (appState.turn === appState.playerColor) {
					ws.send({ type: "REQUEST_ANALYSIS" });
				}
			}
		});
		ws.on("MOVE", (msg) => {
			appState.updateFromMove(msg);
			// In multiplayer, request engine suggestions when it becomes our turn
			if (appState.isMultiplayer && appState.turn === appState.playerColor && !appState.isGameOver) {
				// Mark current suggestions as stale while new ones load
				appState.suggestionsStale = true;
				ws.send({ type: "REQUEST_ANALYSIS" });
			}
		});
		ws.on("GAME_OVER", (msg) => {
			appState.isGameOver = true;
			appState.result = msg.result;
			appState.suggestionsStale = false;
			if (appState.isMultiplayer) {
				appState.suggestions = [];
				// Show loading in AI Coach while waiting for post-game evaluation
				appState.analysisLoading = true;
			} else {
				appState.analysisLoading = false;
			}
		});
		ws.on("SUGGESTIONS", (msg) => {
			appState.updateSuggestions(msg.suggestions);
			// MP autoplay: if active and it's our turn, play the top suggestion
			if (appState.isMultiplayer && appState.autoplayActive && !appState.isGameOver
				&& appState.turn === appState.playerColor && msg.suggestions?.length > 0) {
				const topMove = msg.suggestions[0].move;
				setTimeout(() => {
					if (appState.autoplayActive && !appState.isGameOver) {
						if (topMove.toUpperCase() === "PASS") {
							ws.send({ type: "PASS" });
						} else {
							ws.send({ type: "PLAY_MOVE", move: topMove });
						}
					}
				}, 500); // Small delay so the user can see the suggestion
			}
		});
		ws.on("ANALYSIS", (msg) => {
			const data = msg as any;
			if (data.gameId && data.gameId !== appState.gameId) return;
			appState.addAnalysis(data.text, data.moveNumber);
		});
		ws.on("MOVE_QUALITY", (msg) => { appState.lastMoveQuality = (msg as any).quality; });
		ws.on("HINT", (msg) => { appState.hintLevel = msg.level; });
		ws.on("SKILL_EVAL", (msg) => {
			appState.skillEval = msg as any;
			appState.analysisLoading = false;
		});
		ws.on("GAME_SUMMARY", (msg) => {
			appState.gameSummary = (msg as any).text;
			appState.analysisLoading = false;
		});
		ws.on("PLAYER_COUNT", (msg) => { appState.playerCounts = msg as any; });
		ws.on("ERROR", (msg) => { console.error("[game]", (msg as any).message); });
		// Multiplayer handlers
		ws.on("LOBBY_STATE", (msg) => {
			const data = msg as any;
			console.log("[lobby] received LOBBY_STATE:", data.challenges?.length, "challenges,", data.activePlayers, "players");
			appState.challenges = data.challenges ?? [];
			appState.lobbyPlayerCount = data.activePlayers ?? 0;
		});
		ws.on("MP_GAME_START", (msg) => {
			// Clear stale singleplayer suggestions
			appState.suggestions = [];
			// Sync suggestion count to server for MP
			ws.send({ type: "SET_SUGGESTIONS", count: appState.suggestionCount });
			console.log("[MP] MP_GAME_START received!", msg);
			const data = msg as any;
			appState.isMultiplayer = true;
			appState.opponentName = data.opponentName;
			appState.playerColor = data.yourColor;
			appState.view = "game";
		});
		ws.on("CLOCK_UPDATE", (msg) => {
			const data = msg as any;
			appState.clockWhite = data.white;
			appState.clockBlack = data.black;
			appState.clockRunning = data.running;
		});
		ws.on("EMOJI_RECEIVED", (msg) => {
			const data = msg as any;
			appState.lastEmojiReceived = data.emoji;
			setTimeout(() => appState.lastEmojiReceived = null, 3000);
		});
		ws.on("OPPONENT_DISCONNECTED", () => {
			appState.opponentDisconnected = true;
			console.log("[MP] Opponent disconnected — waiting for reconnect");
		});
		ws.on("OPPONENT_RECONNECTED", () => {
			appState.opponentDisconnected = false;
		});
		(ws as any).debugHandlers?.();
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
		// Check for join code in URL
		const urlMatch = window.location.pathname.match(/\/(?:join|watch)\/([A-Z0-9]{6})/i);
		if (urlMatch) {
			const code = urlMatch[1].toUpperCase();
			const spectate = window.location.pathname.startsWith('/watch');
			ws.send({ type: 'JOIN_BY_CODE', code, spectate });
			window.history.replaceState({}, '', '/');
		}

		// Apply saved theme on startup
		document.documentElement.setAttribute("data-theme", appState.theme);
		if (!autoStarted) {
			autoStarted = true;
			setupHandlers();
			// Identify ourselves FIRST so lobby shows real name
			ws.send({ type: 'SET_NICKNAME', nickname: appState.nickname || appState.userId });
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

	// Challenge notification for non-lobby users
	let challengeNotification = $state<{ id: string; creatorName: string; gameType: string; timeLabel: string } | null>(null);
	let prevChallengeCount = $state(0);

	$effect(() => {
		const challs = appState.challenges;
		if (challs.length > prevChallengeCount && appState.view !== 'lobby') {
			const newest = challs[challs.length - 1];
			if (newest) {
				const mins = Math.floor(newest.timeControl.initial / 60);
				const timeLabel = newest.timeControl.initial === 0 ? 'No limit' : `${mins}+${newest.timeControl.increment}`;
				challengeNotification = { id: newest.id, creatorName: newest.creatorName, gameType: newest.gameType, timeLabel };
				setTimeout(() => { if (challengeNotification?.id === newest.id) challengeNotification = null; }, 15000);
			}
		}
		prevChallengeCount = challs.length;
	});

	function acceptNotification() {
		if (challengeNotification) {
			ws.send({ type: 'ACCEPT_CHALLENGE', challengeId: challengeNotification.id });
			challengeNotification = null;
		}
	}

	let showLeaveConfirm = $state(false);

	function leaveMultiplayer() {
		if (appState.isMultiplayer && !appState.isGameOver && !showLeaveConfirm) {
			showLeaveConfirm = true;
			setTimeout(() => showLeaveConfirm = false, 5000);
			return;
		}
		// Resign if game in progress
		if (appState.isMultiplayer && !appState.isGameOver) {
			ws.send({ type: 'RESIGN' });
		}
		showLeaveConfirm = false;
		// Mark MP as ended but keep the board for pondering
		appState.isMultiplayer = false;
		appState.autoplayActive = false;
	}

	function exitToSingleplayer() {
		appState.opponentName = '';
		appState.suggestions = [];
		appState.skillEval = null;
		appState.gameSummary = null;
		startNewGame();
	}

	function dismissNotification() {
		challengeNotification = null;
	}

	const DIFFICULTY_LABELS: Record<string, string> = {
		beginner: "Beginner",
		casual: "Casual",
		club: "Club",
		pro: "Pro",
		superhuman: "Superhuman",
	};
</script>

<div class="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
	<header class="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] h-[44px] bg-[var(--bg-secondary)]">
		<div class="flex items-center gap-2">
			<button
				class="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-all"
				onclick={() => { if (appState.view === 'review') { appState.view = 'game'; } else { showMenu = !showMenu; } }}
			>
				<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
					{#if showMenu}
						<path d="M4 4L12 12M12 4L4 12" />
					{:else}
						<path d="M2 4H14M2 8H14M2 12H14" />
					{/if}
				</svg>
			</button>
			{#if appState.view === 'lobby'}
				<span class="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wide">Multiplayer</span>
			{:else if appState.view === 'review'}
				<span class="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wide">{tt('header.back')}</span>
			{:else}
				<span class="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wide">{showMenu ? tt('header.close') : gameName}</span>
			{/if}
		</div>

		<div class="flex items-center gap-3">
			<span class="text-[15px] font-bold tracking-tight text-[var(--accent)]">Tess</span>
			{#if appState.isMultiplayer}
				{#if showLeaveConfirm}
					<button
						class="text-[11px] font-bold px-3 py-0.5 rounded-md bg-[var(--danger)] text-white animate-pulse cursor-pointer"
						onclick={leaveMultiplayer}
					>Leave game?</button>
				{:else if appState.isGameOver}
					<button
						class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer hover:bg-[var(--accent)] hover:text-[var(--bg-primary)] transition-all"
						onclick={leaveMultiplayer}
						title="End live session (board stays for review)"
					>LIVE</button>
				{:else}
					<button
						class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] cursor-pointer hover:bg-[var(--danger)] transition-all"
						onclick={leaveMultiplayer}
						title="Click to leave game"
					>LIVE</button>
				{/if}
			{:else}
				<button
					class="text-[11px] font-medium px-2 py-0.5 rounded-md transition-all {appState.view === 'lobby' ? 'bg-[var(--accent)] text-[var(--bg-primary)]' : 'bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}"
					onclick={() => appState.view = appState.view === 'lobby' ? 'game' : 'lobby'}
				>MP</button>
				{#if appState.challenges.length > 0 && appState.view !== 'lobby'}
					{@const ch = appState.challenges[0]}
					<button
						class="text-[11px] font-bold px-3 py-0.5 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-all animate-pulse"
						onclick={() => { ws.send({ type: 'ACCEPT_CHALLENGE', challengeId: ch.id }); }}
						title="{ch.creatorName} wants to play {ch.gameType}"
					>Play {ch.creatorName}</button>
				{/if}
			{/if}
			{#if appState.playerCounts.total > 0}
				<span class="flex items-center gap-1 text-[11px] text-[var(--text-muted)]" title="Players online: {appState.playerCounts.chess} chess, {appState.playerCounts.go} go, {appState.playerCounts.janggi} janggi">
					<span class="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
					{appState.playerCounts.total}
				</span>
			{/if}
		</div>

		<div class="flex items-center gap-3">
			<span class="text-[11px] text-[var(--text-muted)]" title={appState.userId}>
				{appState.nickname ? appState.nickname : appState.userId}
			</span>
			<span class="text-[11px] font-medium text-[var(--text-muted)] px-2 py-0.5 rounded-md bg-[var(--bg-hover)]">{DIFFICULTY_LABELS[appState.difficulty] ?? appState.difficulty}</span>
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

		{#if appState.view === 'lobby'}
			<Lobby {ws} />
		{:else if appState.view === 'review'}
			<Review
				moves={appState.reviewMoves}
				accuracy={appState.skillEval?.accuracy}
				skillLabel={appState.skillEval?.skill.label}
				gameSummary={appState.gameSummary ?? undefined}
			/>
		{:else}
			<Game {ws} />
		{/if}
		<!-- Challenge notification toast -->
		{#if challengeNotification}
			<div class="challenge-toast">
				<div class="toast-content">
					<span class="toast-icon">&#x2694;</span>
					<div class="toast-text">
						<strong>{challengeNotification.creatorName}</strong> wants to play {challengeNotification.gameType}
						<span class="toast-time">{challengeNotification.timeLabel}</span>
					</div>
				</div>
				<div class="toast-actions">
					<button class="toast-accept" onclick={acceptNotification}>Play</button>
					<button class="toast-spectate" onclick={() => { appState.view = "lobby"; dismissNotification(); }}>View</button>
					<button class="toast-dismiss" onclick={dismissNotification}>&#x2715;</button>
				</div>
			</div>
		{/if}
	</main>
</div>

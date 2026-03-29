<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import { playSound } from "../lib/sounds.ts";
	import { t } from "../lib/i18n.ts";
	import type { WsClient } from "../lib/ws.ts";
	import ChessBoard from "../boards/ChessBoard.svelte";
	import GoBoard from "../boards/GoBoard.svelte";
	import JanggiBoard from "../boards/JanggiBoard.svelte";
	import MoveHistory from "../components/MoveHistory.svelte";
	import CapturedPieces from "../components/CapturedPieces.svelte";
	import EvalBar from "../components/EvalBar.svelte";
	import Suggestions from "../components/Suggestions.svelte";
	import Analysis from "../components/Analysis.svelte";

	let { ws, onRematch, onAutoplayRematch }: {
		ws: WsClient;
		onRematch?: (gameType?: "chess" | "go" | "janggi") => void;
		onAutoplayRematch?: () => void;
	} = $props();

	let lastMoveCount = $state(0);
	let hoveredMove = $state<string | null>(null);

	// Sound effects on new moves
	$effect(() => {
		const currentCount = appState.moveHistory.length;
		if (currentCount > lastMoveCount && lastMoveCount > 0) {
			if (appState.isGameOver) {
				playSound("gameEnd");
			} else if (appState.isCheck) {
				playSound("check");
			} else {
				const lastMove = appState.moveHistory[appState.moveHistory.length - 1];
				if (lastMove?.san.includes("x")) {
					playSound("capture");
				} else {
					playSound("move");
				}
			}
		}
		lastMoveCount = currentCount;
	});

	const GO_COLS = "ABCDEFGHJKLMNOPQRST";

	function onMove(from: string, to: string) {
		ws.send({ type: "PLAY_MOVE", move: `${from}${to}` });
	}

	function onGoPlay(x: number, y: number) {
		const coord = `${GO_COLS[x]}${appState.boardSize - y}`;
		ws.send({ type: "PLAY_MOVE", move: coord });
	}

	function playSuggestedMove(move: string) {
		if (appState.suggestionsStale) return; // Don't play stale suggestions
		hoveredMove = null;
		ws.send({ type: "PLAY_MOVE", move });
	}

	let showResignConfirm = $state(false);

	function resign() {
		ws.send({ type: "RESIGN" });
		showResignConfirm = false;
	}

	function newGame() {
		appState.view = "home";
		appState.reset();
	}

	function requestHint() {
		ws.send({ type: "REQUEST_HINT" });
	}

	const isMyTurn = $derived(appState.turn === appState.playerColor);
	// Force re-eval on language change by reading appState.language
	const statusText = $derived.by(() => {
		const _lang = appState.language; // reactive dependency
		if (appState.isGameOver && appState.result) {
			if (appState.result.winner === "draw") return `${t("game.draw", _lang)} - ${appState.result.reason}`;
			const winner = appState.result.winner === appState.playerColor ? t("game.youWin", _lang) : t("game.youLose", _lang);
			return `${winner} - ${appState.result.reason}`;
		}
		if (appState.isCheck) return isMyTurn ? t("game.inCheck", _lang) : t("game.check", _lang);
		return isMyTurn ? t("game.yourTurn", _lang) : t("game.aiThinking", _lang);
	});

	// Split a move string into [from, to] — handles both chess (e2e4) and janggi (a10b10)
	function splitMove(move: string): [string, string] | null {
		if (appState.gameType === "go") return null; // Go moves are single coords
		// Janggi: variable length squares (a1-i10)
		const match = move.match(/^([a-i]\d{1,2})([a-i]\d{1,2})$/);
		if (match) return [match[1], match[2]];
		// Chess: always 4-5 chars
		if (move.length >= 4) return [move.slice(0, 2), move.slice(2, 4)];
		return null;
	}

	// AI opponent display name
	const DIFFICULTY_NAMES: Record<string, string> = {
		beginner: "Tess (Beginner)",
		casual: "Tess (Casual)",
		club: "Tess (Club)",
		pro: "Tess (Pro)",
		superhuman: "Tess (Superhuman)",
	};
	const aiName = $derived(DIFFICULTY_NAMES[appState.difficulty] ?? "Tess");

	// Move quality flash — visible briefly after each move assessment
	const QUALITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
		best: { label: "Best", color: "var(--success)", icon: "!!" },
		good: { label: "Good", color: "#60a5fa", icon: "!" },
		ok: { label: "OK", color: "var(--text-secondary)", icon: "~" },
		inaccuracy: { label: "Inaccuracy", color: "#facc15", icon: "?!" },
		mistake: { label: "Mistake", color: "#fb923c", icon: "?" },
		blunder: { label: "Blunder", color: "var(--danger)", icon: "??" },
	};

	let qualityFlash = $state<string | null>(null);
	let qualityFading = $state(false);

	$effect(() => {
		const q = appState.lastMoveQuality;
		if (q) {
			qualityFlash = q;
			qualityFading = false;
			const fadeTimer = setTimeout(() => qualityFading = true, 2000);
			const clearTimer = setTimeout(() => qualityFlash = null, 3000);
			return () => { clearTimeout(fadeTimer); clearTimeout(clearTimer); };
		}
	});

	// Build arrow shapes — only on hover, not automatically
	const boardArrows = $derived.by(() => {
		if (!hoveredMove || appState.suggestionsStale) return [];
		const split = splitMove(hoveredMove);
		return split ? [split] : [];
	});
</script>

<div class="game-container">
	<!-- Board area: eval bar + board + captured pieces -->
	<div class="board-area">
		<!-- Opponent player bar -->
		<div class="player-bar opponent">
			<div class="player-info">
				<span class="player-icon">&#x265A;</span>
				<span class="player-name">{appState.isMultiplayer ? appState.opponentName : aiName}</span>
				{#if !isMyTurn && !appState.isGameOver}
					<span class="thinking-indicator">
						<span class="thinking-dot"></span>
						<span class="thinking-dot" style="animation-delay: 150ms"></span>
						<span class="thinking-dot" style="animation-delay: 300ms"></span>
					</span>
				{/if}
			</div>
			<CapturedPieces
				pieces={appState.playerColor === 'white' ? appState.capturedPieces.white : appState.capturedPieces.black}
				color={appState.playerColor}
			/>
		</div>
		<CapturedPieces
			pieces={appState.playerColor === 'white' ? appState.capturedPieces.white : appState.capturedPieces.black}
			color={appState.playerColor}
		/>

		<div class="board-with-eval">
			<EvalBar score={appState.eval} orientation={appState.playerColor} />

			{#if appState.gameType === 'go'}
				<GoBoard
					boardState={appState.boardState}
					boardSize={appState.boardSize}
					orientation={appState.playerColor}
					lastMove={appState.goLastMove}
					highlightedMove={hoveredMove}
					onPlay={(x, y) => onGoPlay(x, y)}
				/>
			{:else if appState.gameType === 'janggi'}
				<JanggiBoard
					fen={appState.fen}
					orientation={appState.playerColor}
					legalMoves={isMyTurn && !appState.isGameOver ? appState.legalMoves : {}}
					lastMove={appState.moveHistory.length > 0
						? (() => {
							const last = appState.moveHistory[appState.moveHistory.length - 1];
							return splitMove(last.uci) ?? undefined;
						})()
						: undefined}
					arrows={boardArrows}
					onMove={(from, to) => onMove(from, to)}
				/>
			{:else}
				<ChessBoard
					fen={appState.fen}
					orientation={appState.playerColor}
					legalMoves={isMyTurn && !appState.isGameOver ? appState.legalMoves : {}}
					lastMove={appState.moveHistory.length > 0
						? (() => {
							const last = appState.moveHistory[appState.moveHistory.length - 1];
							return [last.uci.slice(0, 2), last.uci.slice(2, 4)];
						})()
						: undefined}
					isCheck={appState.isCheck}
					turn={appState.turn}
					arrows={boardArrows}
					{onMove}
				/>
			{/if}
		</div>

		<!-- Your player bar -->
		<div class="player-bar you">
			<div class="player-info">
				<span class="player-icon">&#x2654;</span>
				<span class="player-name">{appState.nickname ? appState.nickname : appState.userId}</span>
				{#if qualityFlash && QUALITY_CONFIG[qualityFlash]}
					<span
						class="quality-badge"
						class:fading={qualityFading}
						style="--quality-color: {QUALITY_CONFIG[qualityFlash].color}"
					>
						<span class="quality-icon">{QUALITY_CONFIG[qualityFlash].icon}</span>
						{QUALITY_CONFIG[qualityFlash].label}
					</span>
				{/if}
			</div>
			<CapturedPieces
				pieces={appState.playerColor === 'white' ? appState.capturedPieces.black : appState.capturedPieces.white}
				color={appState.playerColor === 'white' ? 'black' : 'white'}
			/>
		</div>
	</div>

	<!-- Right panel: status + suggestions + analysis + moves + controls -->
	<div class="panel-area">
		<!-- Status bar with prominent turn indicator -->
		<div class="status-bar" class:your-turn={isMyTurn && !appState.isGameOver} class:game-over={appState.isGameOver}>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					{#if !appState.isGameOver && isMyTurn}
						<span class="turn-dot"></span>
					{/if}
					<span class="text-sm font-semibold {appState.isGameOver
						? (appState.result?.winner === appState.playerColor ? 'text-[var(--success)]' : appState.result?.winner === 'draw' ? 'text-[var(--text-secondary)]' : 'text-[var(--danger)]')
						: isMyTurn ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}"
					>
						{statusText}
					</span>
				</div>
				<span class="text-xs font-mono text-[var(--text-muted)]">
					{Math.ceil(appState.moveHistory.length / 2)}
				</span>
			</div>
			{#if appState.opening}
				<div class="text-xs text-[var(--text-muted)] mt-1">
					<span class="font-mono font-semibold text-[var(--accent)]">{appState.opening.eco}</span>
					{appState.opening.name}
				</div>
			{/if}
		</div>

		<!-- Engine Suggestions -->
		<Suggestions
			suggestions={appState.suggestions}
			stale={appState.suggestionsStale}
			moveQuality={appState.lastMoveQuality}
			onHoverMove={(move) => hoveredMove = move}
			onClearHover={() => hoveredMove = null}
			onPlayMove={(move) => playSuggestedMove(move)}
		/>

		<!-- AI Coach (with game review at top when game is over) -->
		{#if appState.coachingEnabled || appState.skillEval}
			<Analysis
				messages={appState.analysisMessages}
				loading={appState.analysisLoading}
				currentMoveNumber={appState.moveHistory.length}
				skillEval={appState.skillEval}
				gameSummary={appState.gameSummary}
			/>
		{/if}

		<!-- Move History -->
		<MoveHistory moves={appState.moveHistory} />

		<!-- Controls -->
		<div class="flex gap-2">
			{#if appState.isGameOver}
				{#if appState.isMultiplayer && onRematch}
					<button
						class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors"
						onclick={() => onRematch?.()}
					>
						Rematch
					</button>
					{#if onAutoplayRematch}
						<button
							class="py-2.5 px-3 rounded-xl text-xs font-medium bg-[var(--success)] text-[var(--bg-primary)] hover:opacity-90 transition-colors"
							onclick={() => onAutoplayRematch?.()}
							title="Rematch with autoplay enabled (same Elo settings)"
						>
							Auto
						</button>
					{/if}
					{#each (["chess", "go", "janggi"] as const).filter(g => g !== appState.gameType) as game}
						<button
							class="py-2.5 px-3 rounded-xl text-xs font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors capitalize"
							onclick={() => onRematch?.(game)}
						>
							{game}
						</button>
					{/each}
				{:else}
					<button
						class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors"
						onclick={newGame}
					>
						{t("game.newGame", appState.language)}
					</button>
				{/if}
				{#if appState.gameType === 'chess'}
					<button
						class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
						onclick={() => { appState.reviewMoves = appState.moveHistory; appState.view = 'review'; }}
					>
						{t("game.review", appState.language)}
					</button>
				{/if}
			{:else}
				<button
					class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)] transition-all flex items-center justify-center gap-1.5"
					onclick={requestHint}
				>
					<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="opacity-70">
						<path d="M8 1a5 5 0 0 0-3 9v1a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1a5 5 0 0 0-3-9zm-1 13a1 1 0 1 0 2 0H7z"/>
					</svg>
					{t("game.hint", appState.language)}
				</button>
				{#if showResignConfirm}
					<button
						class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--danger)] text-white transition-colors animate-pulse"
						onclick={resign}
					>
						Confirm resign?
					</button>
				{:else}
					<button
						class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/20 transition-colors"
						onclick={() => { showResignConfirm = true; setTimeout(() => showResignConfirm = false, 3000); }}
					>
						{t("game.resign", appState.language)}
					</button>
				{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	.game-container {
		display: flex;
		gap: 1rem;
		padding: 0.75rem;
		height: calc(100vh - 49px); /* viewport minus header */
		max-width: 1400px;
		margin: 0 auto;
	}

	.board-area {
		display: flex;
		flex-direction: column;
		justify-content: center;
		flex-shrink: 0;
	}

	.board-with-eval {
		display: flex;
		gap: 4px;
		/* Board fills available height, maintaining square aspect ratio */
		height: min(calc(100vh - 120px), calc(100vw - 400px));
		max-height: 800px;
	}

	.panel-area {
		flex: 1;
		min-width: 0;
		max-width: 380px;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		overflow-y: auto;
	}

	.status-bar {
		padding: 0.75rem;
		border-radius: 12px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		transition: all 0.3s ease;
	}

	.status-bar.your-turn {
		border-color: var(--accent);
		box-shadow: 0 0 12px rgba(56, 189, 248, 0.15), inset 0 0 12px rgba(56, 189, 248, 0.05);
	}

	.status-bar.game-over {
		border-color: var(--text-muted);
	}

	.turn-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
		animation: pulse-dot 2s ease-in-out infinite;
		flex-shrink: 0;
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(0.8); }
	}

	/* Mobile: board-first vertical layout */
	@media (max-width: 768px) {
		.game-container {
			flex-direction: column;
			height: auto;
			min-height: calc(100vh - 44px);
			padding: 0.5rem;
			gap: 0.5rem;
		}

		.board-area {
			width: 100%;
			flex-shrink: 0;
		}

		.board-with-eval {
			height: auto;
			width: 100%;
			max-height: none;
			aspect-ratio: auto;
		}

		.panel-area {
			max-width: none;
			overflow-y: visible;
			gap: 0.5rem;
		}

		.player-bar {
			padding: 1px 4px;
			min-height: 26px;
		}

		.status-bar {
			padding: 0.5rem 0.75rem;
		}
	}
	.player-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 2px 8px;
		min-height: 32px;
	}

	.player-info {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.player-icon {
		font-size: 16px;
		opacity: 0.7;
	}

	.player-name {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.thinking-indicator {
		display: flex;
		gap: 2px;
		margin-left: 4px;
	}

	.thinking-dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--accent);
		animation: bounce 1.4s ease-in-out infinite;
	}

	@keyframes bounce {
		0%, 80%, 100% { transform: translateY(0); }
		40% { transform: translateY(-4px); }
	}

	.quality-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 8px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 700;
		color: var(--quality-color);
		background: color-mix(in srgb, var(--quality-color) 15%, transparent);
		transition: opacity 0.5s ease;
	}

	.quality-badge.fading {
		opacity: 0;
	}

	.quality-icon {
		font-family: "SF Mono", "Cascadia Mono", monospace;
		font-size: 10px;
	}
</style>


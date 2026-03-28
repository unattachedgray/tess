<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import { playSound } from "../lib/sounds.ts";
	import type { WsClient } from "../lib/ws.ts";
	import ChessBoard from "../boards/ChessBoard.svelte";
	import GoBoard from "../boards/GoBoard.svelte";
	import JanggiBoard from "../boards/JanggiBoard.svelte";
	import MoveHistory from "../components/MoveHistory.svelte";
	import CapturedPieces from "../components/CapturedPieces.svelte";
	import EvalBar from "../components/EvalBar.svelte";
	import Suggestions from "../components/Suggestions.svelte";
	import Analysis from "../components/Analysis.svelte";

	let { ws }: { ws: WsClient } = $props();

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
		if (appState.gameType === "go") {
			// Go suggestions are GTP coords like "Q16"
			ws.send({ type: "PLAY_MOVE", move });
		} else {
			// Chess/Janggi suggestions are UCI like "e2e4"
			ws.send({ type: "PLAY_MOVE", move });
		}
	}

	function resign() {
		ws.send({ type: "RESIGN" });
	}

	function newGame() {
		appState.view = "home";
		appState.reset();
	}

	function requestHint() {
		ws.send({ type: "REQUEST_HINT" });
	}

	function toggleCoaching() {
		appState.setCoaching(!appState.coachingEnabled);
		ws.send({ type: "SET_COACHING", enabled: appState.coachingEnabled });
	}

	const isMyTurn = $derived(appState.turn === appState.playerColor);
	const statusText = $derived.by(() => {
		if (appState.isGameOver && appState.result) {
			if (appState.result.winner === "draw") return `Draw - ${appState.result.reason}`;
			const winner = appState.result.winner === appState.playerColor ? "You win" : "You lose";
			return `${winner} - ${appState.result.reason}`;
		}
		if (appState.isCheck) return isMyTurn ? "You're in check!" : "Check!";
		return isMyTurn ? "Your turn" : "AI is thinking...";
	});

	// Build arrow shapes for suggestions
	const boardArrows = $derived.by(() => {
		if (!appState.showArrows || appState.suggestionsStale) return [];

		const arrows: [string, string][] = [];

		// Show hovered suggestion arrow
		if (hoveredMove && hoveredMove.length >= 4) {
			arrows.push([hoveredMove.slice(0, 2), hoveredMove.slice(2, 4)]);
			return arrows;
		}

		// Show best move arrow
		if (appState.suggestions.length > 0) {
			const best = appState.suggestions[0].move;
			if (best.length >= 4) {
				arrows.push([best.slice(0, 2), best.slice(2, 4)]);
			}
		}
		return arrows;
	});
</script>

<div class="game-container">
	<!-- Board area: eval bar + board + captured pieces -->
	<div class="board-area">
		<!-- Opponent captured pieces (pieces they've taken from us) -->
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
							return [last.uci.slice(0, 2), last.uci.slice(2, 4)] as [string, string];
						})()
						: undefined}
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

		<!-- Our captured pieces (pieces we've taken from opponent) -->
		<CapturedPieces
			pieces={appState.playerColor === 'white' ? appState.capturedPieces.black : appState.capturedPieces.white}
			color={appState.playerColor === 'white' ? 'black' : 'white'}
		/>
	</div>

	<!-- Right panel: status + suggestions + analysis + moves + controls -->
	<div class="panel-area">
		<!-- Status bar -->
		<div class="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium {appState.isGameOver
					? (appState.result?.winner === appState.playerColor ? 'text-[var(--success)]' : appState.result?.winner === 'draw' ? 'text-[var(--text-secondary)]' : 'text-[var(--danger)]')
					: isMyTurn ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}"
				>
					{statusText}
				</span>
				<span class="text-xs text-[var(--text-muted)]">
					Move {Math.ceil(appState.moveHistory.length / 2)}
				</span>
			</div>
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

		<!-- AI Coach -->
		{#if appState.coachingEnabled}
			<Analysis
				messages={appState.analysisMessages}
				loading={appState.analysisLoading}
			/>
		{/if}

		<!-- Move History -->
		<MoveHistory moves={appState.moveHistory} />

		<!-- Controls -->
		<div class="flex gap-2">
			{#if appState.isGameOver}
				<button
					class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors"
					onclick={newGame}
				>
					New Game
				</button>
			{:else}
				<button
					class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
					onclick={requestHint}
					title="Get a hint"
				>
					Hint
				</button>
				<button
					class="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors {appState.coachingEnabled
						? 'bg-[var(--accent-glow)] border border-[var(--accent)] text-[var(--accent)]'
						: 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)]'}"
					onclick={toggleCoaching}
					title="Toggle AI coaching"
				>
					Coach {appState.coachingEnabled ? 'ON' : 'OFF'}
				</button>
				<button
					class="py-2.5 px-4 rounded-xl text-sm font-medium bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/20 transition-colors"
					onclick={resign}
				>
					Resign
				</button>
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

	/* Mobile: stack vertically */
	@media (max-width: 768px) {
		.game-container {
			flex-direction: column;
			height: auto;
		}

		.board-with-eval {
			height: auto;
			width: 100%;
			max-height: none;
		}

		.panel-area {
			max-width: none;
		}
	}
</style>

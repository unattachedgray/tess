<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import { playSound } from "../lib/sounds.ts";
	import type { WsClient } from "../lib/ws.ts";
	import ChessBoard from "../boards/ChessBoard.svelte";
	import MoveHistory from "../components/MoveHistory.svelte";
	import CapturedPieces from "../components/CapturedPieces.svelte";

	let { ws }: { ws: WsClient } = $props();

	let lastMoveCount = $state(0);

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

	function onMove(from: string, to: string) {
		ws.send({ type: "PLAY_MOVE", move: `${from}${to}` });
	}

	function resign() {
		ws.send({ type: "RESIGN" });
	}

	function newGame() {
		appState.view = "home";
		appState.reset();
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
</script>

<div class="flex flex-col lg:flex-row gap-4 p-4 max-w-6xl mx-auto">
	<!-- Board -->
	<div class="flex-shrink-0">
		<CapturedPieces
			pieces={appState.playerColor === 'white' ? appState.capturedPieces.black : appState.capturedPieces.white}
			color={appState.playerColor === 'white' ? 'black' : 'white'}
		/>

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
			{onMove}
		/>

		<CapturedPieces
			pieces={appState.playerColor === 'white' ? appState.capturedPieces.white : appState.capturedPieces.black}
			color={appState.playerColor}
		/>
	</div>

	<!-- Side Panel -->
	<div class="flex-1 min-w-0 space-y-4">
		<!-- Status -->
		<div class="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium {appState.isGameOver
					? (appState.result?.winner === appState.playerColor ? 'text-[var(--success)]' : 'text-[var(--danger)]')
					: isMyTurn ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}"
				>
					{statusText}
				</span>
				<span class="text-xs text-[var(--text-muted)]">
					Move {Math.ceil(appState.moveHistory.length / 2)}
				</span>
			</div>
		</div>

		<!-- Move History -->
		<MoveHistory moves={appState.moveHistory} />

		<!-- Controls -->
		<div class="flex gap-2">
			{#if appState.isGameOver}
				<button
					class="flex-1 py-3 rounded-xl text-sm font-medium bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors"
					onclick={newGame}
				>
					New Game
				</button>
			{:else}
				<button
					class="flex-1 py-3 rounded-xl text-sm font-medium bg-[var(--danger)] text-white hover:opacity-90 transition-opacity"
					onclick={resign}
				>
					Resign
				</button>
			{/if}
		</div>
	</div>
</div>

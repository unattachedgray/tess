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
	import ChatBox from "../components/ChatBox.svelte";
	import PlayerStats from "../components/PlayerStats.svelte";
	import Clock from "../components/Clock.svelte";

	// Clock display: opponent's clock is the opposite color
	const opponentColor = $derived(appState.playerColor === 'white' ? 'black' : 'white');
	const showClocks = $derived(appState.isMultiplayer && (appState.clockWhite > 0 || appState.clockBlack > 0));

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
			let reason = t(`reason.${appState.result.reason}`, _lang) || appState.result.reason;
			if (appState.result.margin !== undefined && appState.result.margin > 0) {
				reason += ` (+${appState.result.margin})`;
			}
			if (appState.result.winner === "draw") return `${t("game.draw", _lang)} - ${reason}`;
			const winner = appState.result.winner === appState.playerColor ? t("game.youWin", _lang) : t("game.youLose", _lang);
			return `${winner} - ${reason}`;
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

	// AI opponent display name (reactive for language changes)
	const aiName = $derived(`Tess (${t(`menu.difficulty`, appState.language)} ${appState.difficulty})`);

	// Move quality flash — colors/icons are static, labels are i18n
	const QUALITY_STYLE: Record<string, { color: string; icon: string }> = {
		best: { color: "var(--success)", icon: "!!" },
		good: { color: "#60a5fa", icon: "!" },
		ok: { color: "var(--text-secondary)", icon: "~" },
		inaccuracy: { color: "#facc15", icon: "?!" },
		mistake: { color: "#fb923c", icon: "?" },
		blunder: { color: "var(--danger)", icon: "??" },
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

	// Build arrow shapes — suggestion hover, or a level-2 hint
	const boardArrows = $derived.by(() => {
		if (hoveredMove && !appState.suggestionsStale) {
			const split = splitMove(hoveredMove);
			if (split) return [split];
		}
		const h = appState.hint;
		if (h?.from && h.to) return [[h.from, h.to] as [string, string]];
		return [];
	});

	// Level-1 hint: mark the origin square (chess/janggi) without revealing the move
	const hintOrigin = $derived.by(() => {
		const h = appState.hint;
		return h && h.level === 1 && h.from ? h.from : null;
	});

	// Go hint: level 2 shows the exact point; level 1 only names a board area
	const goHintMove = $derived(appState.hint?.move ?? null);

	function pass() {
		ws.send({ type: "PASS" });
	}

	let drawOfferSent = $state(false);
	function offerDraw() {
		ws.send({ type: "OFFER_DRAW" });
		drawOfferSent = true;
		setTimeout(() => { drawOfferSent = false; }, 10000);
	}

	function respondDraw(accept: boolean) {
		ws.send({ type: "RESPOND_DRAW", accept });
		appState.drawOffered = false;
	}

	function takeback() {
		ws.send({ type: "UNDO" });
	}

	// The player has a move to take back (their move exists in the history)
	const canTakeback = $derived.by(() => {
		if (appState.isMultiplayer || appState.autoplayActive) return false;
		const firstMover = appState.gameType === "go" ? "black" : "white";
		const mine = appState.moveHistory.filter((_, i) =>
			(i % 2 === 0 ? firstMover : firstMover === "white" ? "black" : "white") === appState.playerColor,
		);
		return mine.length > 0;
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
			<div class="player-bar-right">
				{#if appState.gameType === 'go'}
					<span class="prisoner-count" title={t("go.captures", appState.language)}>
						<span class="prisoner-stone" class:white-stone={opponentColor === 'black'}></span>
						{opponentColor === 'white' ? appState.prisoners.white : appState.prisoners.black}
					</span>
				{:else}
					<CapturedPieces
						pieces={appState.playerColor === 'white' ? appState.capturedPieces.white : appState.capturedPieces.black}
						color={appState.playerColor}
					/>
				{/if}
				{#if showClocks}
					<Clock
						time={opponentColor === 'white' ? appState.clockWhite : appState.clockBlack}
						running={appState.clockRunning === opponentColor}
						side={opponentColor}
					/>
				{/if}
			</div>
		</div>

		<div class="board-with-eval" style="position: relative;">
			<!-- Floating emoji/message overlay -->
			{#if appState.lastEmojiReceived || appState.lastMessageReceived}
				<div class="received-overlay">
					{#if appState.lastEmojiReceived}
						<span class="overlay-emoji">{appState.lastEmojiReceived}</span>
					{:else if appState.lastMessageReceived}
						<span class="overlay-msg">{appState.lastMessageReceived.from}: {appState.lastMessageReceived.message}</span>
					{/if}
				</div>
			{/if}
			<EvalBar score={appState.eval} orientation={appState.playerColor} />

			{#key appState.gameType}
			{#if appState.gameType === 'go'}
				<GoBoard
					boardState={appState.boardState}
					boardSize={appState.boardSize}
					orientation={appState.playerColor}
					lastMove={appState.goLastMove}
					highlightedMove={hoveredMove ?? goHintMove}
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
					checkSquare={appState.checkSquare}
					hintSquare={hintOrigin}
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
					highlightSquares={hintOrigin ? [hintOrigin] : []}
					{onMove}
				/>
			{/if}
			{/key}
		</div>

		<!-- Your player bar -->
		<div class="player-bar you">
			<div class="player-info">
				<span class="player-icon">&#x2654;</span>
				<span class="player-name">{appState.nickname ? appState.nickname : appState.userId}</span>
				{#if qualityFlash && QUALITY_STYLE[qualityFlash]}
					<span
						class="quality-badge"
						class:fading={qualityFading}
						style="--quality-color: {QUALITY_STYLE[qualityFlash].color}"
					>
						<span class="quality-icon">{QUALITY_STYLE[qualityFlash].icon}</span>
						{t(`quality.${qualityFlash}`, appState.language)}
					</span>
					{#if (qualityFlash === 'mistake' || qualityFlash === 'blunder') && canTakeback && !appState.isGameOver}
						<button class="retry-chip" class:fading={qualityFading} onclick={takeback}>
							{t("game.takeback", appState.language)}
						</button>
					{/if}
				{/if}
			</div>
			<div class="player-bar-right">
				{#if appState.gameType === 'go'}
					<span class="prisoner-count" title={t("go.captures", appState.language)}>
						<span class="prisoner-stone" class:white-stone={appState.playerColor === 'black'}></span>
						{appState.playerColor === 'white' ? appState.prisoners.white : appState.prisoners.black}
					</span>
				{:else}
					<CapturedPieces
						pieces={appState.playerColor === 'white' ? appState.capturedPieces.black : appState.capturedPieces.white}
						color={appState.playerColor === 'white' ? 'black' : 'white'}
					/>
				{/if}
				{#if showClocks}
					<Clock
						time={appState.playerColor === 'white' ? appState.clockWhite : appState.clockBlack}
						running={appState.clockRunning === appState.playerColor}
						side={appState.playerColor}
					/>
				{/if}
			</div>
		</div>
		<!-- Player stats -->
		<PlayerStats />
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
				{#if appState.moveHistory.length > 0 || appState.spectatorCount > 0}
					<span class="text-xs font-mono text-[var(--text-muted)]">
						{Math.ceil(appState.moveHistory.length / 2)}{#if appState.isGameOver && appState.gameStartTime} · {Math.round((Date.now() - appState.gameStartTime) / 60000)}m{/if}{#if appState.spectatorCount > 0}&ensp;👁 {appState.spectatorCount}{/if}
					</span>
				{/if}
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

		<!-- Chat (multiplayer only) -->
		{#if appState.isMultiplayer}
			<ChatBox {ws} />
		{/if}

		<!-- Move History -->
		<MoveHistory moves={appState.moveHistory} />

		<!-- Incoming draw offer -->
		{#if appState.drawOffered && !appState.isGameOver}
			<div class="flex items-center justify-between gap-2 py-2 px-3 rounded-xl bg-[var(--accent-glow)] border border-[var(--accent)]/40">
				<span class="text-sm font-medium text-[var(--accent)]">{t("game.drawOffered", appState.language)}</span>
				<div class="flex gap-1.5">
					<button
						class="text-xs font-bold px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors"
						onclick={() => respondDraw(true)}
					>{t("game.acceptDraw", appState.language)}</button>
					<button
						class="text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
						onclick={() => respondDraw(false)}
					>{t("game.declineDraw", appState.language)}</button>
				</div>
			</div>
		{/if}

		<!-- Level-1 Go hint: name the area without revealing the point -->
		{#if appState.hint?.area}
			<div class="text-xs text-center text-[var(--accent)] py-1 px-2 rounded-lg bg-[var(--accent-glow)]">
				{t("game.hintArea", appState.language)} {t(appState.hint.area, appState.language)}
			</div>
		{/if}

		<!-- Controls -->
		<div class="flex gap-2">
			{#if appState.isGameOver}
				{#if appState.isMultiplayer && onRematch}
					<button
						class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors"
						onclick={() => onRematch?.()}
					>
						{t("game.rematch", appState.language)}
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
					{#if canTakeback && appState.result?.reason !== 'resignation'}
						<button
							class="py-2.5 px-3 rounded-xl text-sm font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
							onclick={takeback}
							title={t("game.takebackTitle", appState.language)}
						>
							{t("game.takeback", appState.language)}
						</button>
					{/if}
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
				{#if !appState.isMultiplayer}
					<button
						class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)] transition-all flex items-center justify-center gap-1.5"
						onclick={requestHint}
						title={appState.hint?.level === 1 ? t("game.hintAgain", appState.language) : undefined}
					>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="opacity-70">
							<path d="M8 1a5 5 0 0 0-3 9v1a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1a5 5 0 0 0-3-9zm-1 13a1 1 0 1 0 2 0H7z"/>
						</svg>
						{t("game.hint", appState.language)}{#if appState.hint}&nbsp;{appState.hint.level}/2{/if}
					</button>
				{:else}
					<button
						class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
						onclick={offerDraw}
						disabled={drawOfferSent}
					>
						{drawOfferSent ? t("game.drawSent", appState.language) : t("game.offerDraw", appState.language)}
					</button>
				{/if}
				{#if appState.gameType === 'go'}
					<button
						class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
						onclick={pass}
						disabled={!isMyTurn}
					>
						{t("game.pass", appState.language)}
					</button>
				{/if}
				{#if canTakeback}
					<button
						class="py-2.5 px-3 rounded-xl text-sm font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
						onclick={takeback}
						title={t("game.takebackTitle", appState.language)}
					>
						{t("game.takeback", appState.language)}
					</button>
				{/if}
				{#if showResignConfirm}
					<button
						class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[var(--danger)] text-white transition-colors animate-pulse"
						onclick={resign}
					>
						{t("game.confirmResign", appState.language)}
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
		justify-content: center;
		gap: 1rem;
		padding: 0.75rem;
		height: calc(100dvh - 76px); /* viewport minus header (44px) and footer (32px) */
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
		height: min(calc(100dvh - 150px), calc(100vw - 400px));
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
		box-shadow:
			0 0 12px var(--accent-glow),
			inset 0 0 12px color-mix(in srgb, var(--accent) 5%, transparent);
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
			min-height: calc(100dvh - 44px);
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

	.player-bar-right {
		display: flex;
		align-items: center;
		gap: 6px;
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

	.retry-chip {
		font-size: 11px;
		font-weight: 600;
		padding: 1px 8px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg-secondary);
		color: var(--text-secondary);
		cursor: pointer;
		transition: opacity 0.5s ease, color 0.15s ease, border-color 0.15s ease;
	}
	.retry-chip:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
	.retry-chip.fading {
		opacity: 0;
		pointer-events: none;
	}

	.prisoner-count {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--text-secondary);
	}

	.prisoner-stone {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #1a1a1a;
		border: 1px solid #000;
	}

	.prisoner-stone.white-stone {
		background: #f5f5f5;
		border-color: #ccc;
	}

	.quality-icon {
		font-family: var(--font-mono);
		font-size: 10px;
	}

	.received-overlay {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 20;
		pointer-events: none;
		animation: overlay-in 0.3s ease-out;
	}

	.overlay-emoji {
		font-size: 56px;
		filter: drop-shadow(0 2px 12px rgba(0, 0, 0, 0.4));
		animation: emoji-bounce 0.5s ease;
	}

	.overlay-msg {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
		background: var(--bg-secondary);
		border: 1px solid var(--accent);
		padding: 8px 16px;
		border-radius: 12px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		white-space: nowrap;
	}

	@keyframes overlay-in {
		from { opacity: 0; transform: translate(-50%, -40%); }
		to { opacity: 1; transform: translate(-50%, -50%); }
	}

	@keyframes emoji-bounce {
		0% { transform: scale(0.5); }
		50% { transform: scale(1.3); }
		100% { transform: scale(1); }
	}
</style>


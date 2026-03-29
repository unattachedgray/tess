<script lang="ts">
	import { ChessGame } from "@tess/shared";

	function escapeHtml(s: string): string {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}
	import { Chessground } from "chessground";
	import type { Api } from "chessground/api";
	import type { Key } from "chessground/types";
	import { onMount } from "svelte";

	let {
		moves,
		pgn = "",
		accuracy,
		skillLabel,
		gameSummary,
	}: {
		moves: { san: string; uci: string; fen: string; moveNumber: number }[];
		pgn?: string;
		accuracy?: number;
		skillLabel?: string;
		gameSummary?: string;
	} = $props();

	let currentIndex = $state(0);
	let boardEl: HTMLElement;
	let api: Api | null = null;

	// Replay: rebuild FEN at each position
	const positions = $derived.by(() => {
		const game = new ChessGame();
		const fens = [game.fen]; // starting position
		for (const move of moves) {
			game.moveUci(move.uci);
			fens.push(game.fen);
		}
		return fens;
	});

	const currentFen = $derived(positions[currentIndex] ?? positions[0]);
	const currentMove = $derived(currentIndex > 0 ? moves[currentIndex - 1] : null);
	const lastMoveSquares = $derived.by(() => {
		if (!currentMove) return undefined;
		const uci = currentMove.uci;
		return [uci.slice(0, 2), uci.slice(2, 4)] as [Key, Key];
	});

	// Move pairs for display
	const movePairs = $derived.by(() => {
		const pairs: { number: number; white?: { san: string; idx: number }; black?: { san: string; idx: number } }[] = [];
		for (let i = 0; i < moves.length; i += 2) {
			pairs.push({
				number: Math.floor(i / 2) + 1,
				white: moves[i] ? { san: moves[i].san, idx: i + 1 } : undefined,
				black: moves[i + 1] ? { san: moves[i + 1].san, idx: i + 2 } : undefined,
			});
		}
		return pairs;
	});

	onMount(() => {
		api = Chessground(boardEl, {
			fen: currentFen,
			viewOnly: true,
			coordinates: true,
			animation: { enabled: true, duration: 200 },
			highlight: { lastMove: true },
		});
	});

	$effect(() => {
		api?.set({
			fen: currentFen,
			lastMove: lastMoveSquares,
		});
	});

	function goTo(idx: number) {
		currentIndex = Math.max(0, Math.min(positions.length - 1, idx));
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === "ArrowLeft") goTo(currentIndex - 1);
		else if (e.key === "ArrowRight") goTo(currentIndex + 1);
		else if (e.key === "Home") goTo(0);
		else if (e.key === "End") goTo(positions.length - 1);
	}
</script>

<svelte:window onkeydown={handleKey} />

<div class="flex flex-col lg:flex-row gap-4 p-4 max-w-6xl mx-auto" style="height: calc(100vh - 49px)">
	<!-- Board -->
	<div class="flex-shrink-0 flex items-center justify-center">
		<div class="review-board">
			<div bind:this={boardEl} class="board"></div>
		</div>
	</div>

	<!-- Panel -->
	<div class="flex-1 min-w-0 max-w-sm flex flex-col gap-3 overflow-hidden">
		<!-- Navigation controls -->
		<div class="flex items-center gap-2">
			<button class="px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-sm hover:bg-[var(--bg-hover)]" onclick={() => goTo(0)}>⏮</button>
			<button class="px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-sm hover:bg-[var(--bg-hover)]" onclick={() => goTo(currentIndex - 1)}>◀</button>
			<span class="flex-1 text-center text-xs text-[var(--text-muted)]">
				{currentIndex} / {moves.length}
			</span>
			<button class="px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-sm hover:bg-[var(--bg-hover)]" onclick={() => goTo(currentIndex + 1)}>▶</button>
			<button class="px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-sm hover:bg-[var(--bg-hover)]" onclick={() => goTo(positions.length - 1)}>⏭</button>
		</div>

		<!-- Skill summary -->
		{#if accuracy !== undefined}
			<div class="p-3 rounded-xl bg-[var(--accent-glow)] border border-[var(--accent)]/30">
				<div class="flex items-center justify-between mb-1">
					<span class="text-sm font-bold text-[var(--accent)]">{skillLabel}</span>
					<span class="text-xs text-[var(--text-secondary)]">{accuracy}% accuracy</span>
				</div>
				{#if gameSummary}
					<div class="text-xs text-[var(--text-secondary)] leading-relaxed">
						{@html escapeHtml(gameSummary).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Move list -->
		<div class="flex-1 overflow-y-auto rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] p-2">
			<div class="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-0.5 text-sm">
				{#each movePairs as pair}
					<span class="text-[var(--text-muted)] text-right">{pair.number}.</span>
					{#if pair.white}
						<button
							class="font-mono px-1 rounded text-left {currentIndex === pair.white.idx ? 'bg-[var(--accent)] text-[var(--bg-primary)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}"
							onclick={() => goTo(pair.white!.idx)}
						>{pair.white.san}</button>
					{:else}
						<span></span>
					{/if}
					{#if pair.black}
						<button
							class="font-mono px-1 rounded text-left {currentIndex === pair.black.idx ? 'bg-[var(--accent)] text-[var(--bg-primary)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}"
							onclick={() => goTo(pair.black!.idx)}
						>{pair.black.san}</button>
					{:else}
						<span></span>
					{/if}
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.review-board {
		width: min(100%, calc(100vh - 120px));
		aspect-ratio: 1 / 1;
		max-width: 560px;
		position: relative;
	}
	.board {
		position: absolute;
		inset: 0;
	}
	.board :global(cg-wrap) {
		width: 100% !important;
		height: 100% !important;
	}
</style>

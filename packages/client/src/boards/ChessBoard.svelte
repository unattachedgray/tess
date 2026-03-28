<script lang="ts">
	import { Chessground } from "chessground";
	import type { Api } from "chessground/api";
	import type { Key } from "chessground/types";

	let {
		fen,
		orientation,
		legalMoves = {},
		lastMove,
		isCheck = false,
		turn,
		onMove,
	}: {
		fen: string;
		orientation: "white" | "black";
		legalMoves: Record<string, string[]>;
		lastMove?: [string, string];
		isCheck: boolean;
		turn: "white" | "black";
		onMove: (from: string, to: string) => void;
	} = $props();

	let boardEl: HTMLElement;
	let api: Api | null = null;

	// Convert legalMoves to chessground dests format
	function toDests(moves: Record<string, string[]>): Map<Key, Key[]> {
		const dests = new Map<Key, Key[]>();
		for (const [from, tos] of Object.entries(moves)) {
			dests.set(from as Key, tos as Key[]);
		}
		return dests;
	}

	$effect(() => {
		if (!boardEl) return;

		if (!api) {
			api = Chessground(boardEl, {
				fen,
				orientation,
				turnColor: turn,
				movable: {
					free: false,
					color: orientation,
					dests: toDests(legalMoves),
					events: {
						after(orig, dest) {
							onMove(orig as string, dest as string);
						},
					},
				},
				lastMove: lastMove as [Key, Key] | undefined,
				check: isCheck,
				animation: { enabled: true, duration: 200 },
				draggable: { enabled: true },
				premovable: { enabled: false },
				highlight: { lastMove: true, check: true },
				coordinates: true,
			});
		} else {
			api.set({
				fen,
				orientation,
				turnColor: turn,
				movable: {
					free: false,
					color: orientation,
					dests: toDests(legalMoves),
				},
				lastMove: lastMove as [Key, Key] | undefined,
				check: isCheck,
			});
		}
	});
</script>

<div class="board-container">
	<div bind:this={boardEl} class="board"></div>
</div>

<style>
	.board-container {
		width: min(100%, 560px);
		aspect-ratio: 1;
	}

	.board {
		width: 100%;
		height: 100%;
	}
</style>

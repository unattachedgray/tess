<script lang="ts">
	import { Chessground } from "chessground";
	import type { Api } from "chessground/api";
	import type { Key, Color } from "chessground/types";
	import { onMount } from "svelte";

	let {
		fen,
		orientation,
		legalMoves = {},
		lastMove,
		isCheck = false,
		turn,
		arrows = [],
		onMove,
	}: {
		fen: string;
		orientation: "white" | "black";
		legalMoves: Record<string, string[]>;
		lastMove?: [string, string];
		isCheck: boolean;
		turn: "white" | "black";
		arrows?: [string, string][];
		onMove: (from: string, to: string) => void;
	} = $props();

	let boardEl: HTMLElement;
	let api: Api | null = null;

	function toDests(moves: Record<string, string[]>): Map<Key, Key[]> {
		const dests = new Map<Key, Key[]>();
		for (const [from, tos] of Object.entries(moves)) {
			dests.set(from as Key, tos as Key[]);
		}
		return dests;
	}

	function toDrawShapes(arrs: [string, string][]): { orig: Key; dest: Key; brush: string }[] {
		return arrs.map((a, i) => ({
			orig: a[0] as Key,
			dest: a[1] as Key,
			brush: i === 0 ? "green" : "blue",
		}));
	}

	onMount(() => {
		api = Chessground(boardEl, {
			fen,
			orientation,
			turnColor: turn as Color,
			movable: {
				free: false,
				color: orientation as Color,
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
			drawable: {
				enabled: true,
				visible: true,
				autoShapes: toDrawShapes(arrows),
			},
		});
	});

	$effect(() => {
		if (!api) return;
		api.set({
			fen,
			orientation,
			turnColor: turn as Color,
			movable: {
				free: false,
				color: orientation as Color,
				dests: toDests(legalMoves),
			},
			lastMove: lastMove as [Key, Key] | undefined,
			check: isCheck,
			drawable: {
				autoShapes: toDrawShapes(arrows),
			},
		});
	});
</script>

<div class="board-wrap">
	<div bind:this={boardEl} class="board"></div>
</div>

<style>
	.board-wrap {
		aspect-ratio: 1 / 1;
		height: 100%;
		position: relative;
	}

	@media (max-width: 768px) {
		.board-wrap {
			height: auto;
			width: 100%;
		}
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

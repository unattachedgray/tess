<script lang="ts">
	import type { StoneColor } from "@tess/shared/src/games/go.js";

	let {
		boardState,
		boardSize = 19,
		orientation = "black",
		lastMove,
		onPlay,
	}: {
		boardState: (string | null)[][];
		boardSize: number;
		orientation: string;
		lastMove?: { x: number; y: number } | null;
		onPlay: (x: number, y: number) => void;
	} = $props();

	const GO_COLS = "ABCDEFGHJKLMNOPQRST";
	const STONE_RADIUS = 0.45;

	const cellSize = $derived(100 / (boardSize + 1));

	function coordToSvg(n: number): number {
		return (n + 1) * cellSize;
	}

	// Star points (hoshi) positions
	const starPoints = $derived.by(() => {
		if (boardSize === 19) return [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]];
		if (boardSize === 13) return [[3,3],[3,9],[6,6],[9,3],[9,9]];
		if (boardSize === 9) return [[2,2],[2,6],[4,4],[6,2],[6,6]];
		return [];
	});

	let hoverPos = $state<{ x: number; y: number } | null>(null);

	function handleClick(x: number, y: number) {
		const stone = boardState[y]?.[x];
		if (stone) return; // occupied (has a stone)
		onPlay(x, y);
	}
</script>

<div class="go-board-wrap">
	<svg viewBox="0 0 100 100" class="go-board">
		<!-- Board background -->
		<rect width="100" height="100" fill="#DCB35C" rx="1" />

		<!-- Grid lines -->
		{#each Array(boardSize) as _, i}
			<!-- Vertical lines -->
			<line
				x1={coordToSvg(i)} y1={coordToSvg(0)}
				x2={coordToSvg(i)} y2={coordToSvg(boardSize - 1)}
				stroke="#5C4A1E" stroke-width="0.15"
			/>
			<!-- Horizontal lines -->
			<line
				x1={coordToSvg(0)} y1={coordToSvg(i)}
				x2={coordToSvg(boardSize - 1)} y2={coordToSvg(i)}
				stroke="#5C4A1E" stroke-width="0.15"
			/>
		{/each}

		<!-- Coordinate labels -->
		{#each Array(boardSize) as _, i}
			<!-- Column letters (top) -->
			<text
				x={coordToSvg(i)} y={cellSize * 0.45}
				text-anchor="middle" font-size={cellSize * 0.4} fill="#8B6914" class="select-none"
			>{GO_COLS[i]}</text>
			<!-- Row numbers (left) -->
			<text
				x={cellSize * 0.4} y={coordToSvg(i) + cellSize * 0.15}
				text-anchor="middle" font-size={cellSize * 0.4} fill="#8B6914" class="select-none"
			>{boardSize - i}</text>
		{/each}

		<!-- Star points -->
		{#each starPoints as [sx, sy]}
			<circle cx={coordToSvg(sx)} cy={coordToSvg(sy)} r={cellSize * 0.08} fill="#5C4A1E" />
		{/each}

		<!-- Click targets (invisible rects for each intersection) -->
		{#each Array(boardSize) as _, y}
			{#each Array(boardSize) as _, x}
				<rect
					x={coordToSvg(x) - cellSize / 2}
					y={coordToSvg(y) - cellSize / 2}
					width={cellSize}
					height={cellSize}
					fill="transparent"
					class="cursor-pointer"
					onclick={() => handleClick(x, y)}
					onmouseenter={() => hoverPos = { x, y }}
					onmouseleave={() => hoverPos = null}
					role="button"
					tabindex="-1"
				/>
			{/each}
		{/each}

		<!-- Stones -->
		{#each Array(boardSize) as _, y}
			{#each Array(boardSize) as _, x}
				{#if boardState[y]?.[x]}
					<circle
						cx={coordToSvg(x)}
						cy={coordToSvg(y)}
						r={cellSize * STONE_RADIUS}
						fill={boardState[y][x] === 'black' ? '#1a1a1a' : '#f5f5f5'}
						stroke={boardState[y][x] === 'black' ? '#000' : '#ccc'}
						stroke-width="0.15"
					/>
					<!-- Last move marker -->
					{#if lastMove && lastMove.x === x && lastMove.y === y}
						<circle
							cx={coordToSvg(x)}
							cy={coordToSvg(y)}
							r={cellSize * 0.12}
							fill={boardState[y][x] === 'black' ? '#fff' : '#333'}
						/>
					{/if}
				{/if}
			{/each}
		{/each}

		<!-- Hover ghost stone -->
		{#if hoverPos && !boardState[hoverPos.y]?.[hoverPos.x] && boardState.length > 0}
			<circle
				cx={coordToSvg(hoverPos.x)}
				cy={coordToSvg(hoverPos.y)}
				r={cellSize * STONE_RADIUS}
				fill={orientation === 'black' ? 'rgba(26,26,26,0.3)' : 'rgba(245,245,245,0.3)'}
			/>
		{/if}
	</svg>
</div>

<style>
	.go-board-wrap {
		aspect-ratio: 1 / 1;
		height: 100%;
		position: relative;
	}

	.go-board {
		width: 100%;
		height: 100%;
	}

	.select-none {
		user-select: none;
		pointer-events: none;
	}
</style>

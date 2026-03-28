<script lang="ts">
	let {
		fen,
		orientation = "white",
		legalMoves = {},
		lastMove,
		arrows = [],
		onMove,
	}: {
		fen: string;
		orientation: string;
		legalMoves: Record<string, string[]>;
		lastMove?: [string, string];
		arrows?: [string, string][];
		onMove: (from: string, to: string) => void;
	} = $props();

	let selected = $state<string | null>(null);
	let validDests = $state<string[]>([]);

	// Parse FEN to grid
	const grid = $derived.by(() => {
		const rows = fen.split(" ")[0].split("/");
		const result: string[][] = [];
		for (const row of rows) {
			const gridRow: string[] = [];
			for (const ch of row) {
				const n = parseInt(ch, 10);
				if (!isNaN(n)) {
					for (let i = 0; i < n; i++) gridRow.push("");
				} else {
					gridRow.push(ch);
				}
			}
			result.push(gridRow);
		}
		return result;
	});

	const PIECE_DISPLAY: Record<string, { char: string; color: string }> = {
		R: { char: "車", color: "#1a5fb4" },
		N: { char: "馬", color: "#1a5fb4" },
		B: { char: "象", color: "#1a5fb4" },
		A: { char: "士", color: "#1a5fb4" },
		K: { char: "將", color: "#1a5fb4" },
		C: { char: "砲", color: "#1a5fb4" },
		P: { char: "兵", color: "#1a5fb4" },
		r: { char: "車", color: "#c01c28" },
		n: { char: "馬", color: "#c01c28" },
		b: { char: "象", color: "#c01c28" },
		a: { char: "士", color: "#c01c28" },
		k: { char: "將", color: "#c01c28" },
		c: { char: "砲", color: "#c01c28" },
		p: { char: "卒", color: "#c01c28" },
	};

	function sqToSvg(sq: string): { x: number; y: number } | null {
		const col = sq.charCodeAt(0) - 97;
		const rank = parseInt(sq.slice(1), 10);
		const row = 10 - rank;
		if (col < 0 || col > 8 || row < 0 || row > 9) return null;
		return { x: 8 + col * 10.5, y: 8 + row * 10.5 };
	}

	function toSquare(col: number, row: number): string {
		return `${String.fromCharCode(97 + col)}${10 - row}`;
	}

	function handleClick(col: number, row: number) {
		const sq = toSquare(col, row);

		if (selected) {
			if (validDests.includes(sq)) {
				onMove(selected, sq);
				selected = null;
				validDests = [];
				return;
			}
			// Clicking a new own piece
			if (legalMoves[sq]) {
				selected = sq;
				validDests = legalMoves[sq];
				return;
			}
			selected = null;
			validDests = [];
			return;
		}

		if (legalMoves[sq]) {
			selected = sq;
			validDests = legalMoves[sq];
		}
	}

	function isSelected(col: number, row: number): boolean {
		return selected === toSquare(col, row);
	}

	function isDest(col: number, row: number): boolean {
		return validDests.includes(toSquare(col, row));
	}

	function isLastMove(col: number, row: number): boolean {
		if (!lastMove) return false;
		const sq = toSquare(col, row);
		return sq === lastMove[0] || sq === lastMove[1];
	}
</script>

<div class="janggi-wrap">
	<svg viewBox="0 0 100 110" class="janggi-board">
		<!-- Board background -->
		<rect width="100" height="110" fill="#E8C07A" rx="2" />

		<!-- Grid lines -->
		{#each Array(9) as _, c}
			<line
				x1={8 + c * 10.5} y1={8}
				x2={8 + c * 10.5} y2={8 + 9 * 10.5}
				stroke="#8B6914" stroke-width="0.3"
			/>
		{/each}
		{#each Array(10) as _, r}
			<line
				x1={8} y1={8 + r * 10.5}
				x2={8 + 8 * 10.5} y2={8 + r * 10.5}
				stroke="#8B6914" stroke-width="0.3"
			/>
		{/each}

		<!-- Palace diagonals (top) -->
		<line x1={8 + 3 * 10.5} y1={8} x2={8 + 5 * 10.5} y2={8 + 2 * 10.5} stroke="#8B6914" stroke-width="0.2" />
		<line x1={8 + 5 * 10.5} y1={8} x2={8 + 3 * 10.5} y2={8 + 2 * 10.5} stroke="#8B6914" stroke-width="0.2" />
		<!-- Palace diagonals (bottom) -->
		<line x1={8 + 3 * 10.5} y1={8 + 7 * 10.5} x2={8 + 5 * 10.5} y2={8 + 9 * 10.5} stroke="#8B6914" stroke-width="0.2" />
		<line x1={8 + 5 * 10.5} y1={8 + 7 * 10.5} x2={8 + 3 * 10.5} y2={8 + 9 * 10.5} stroke="#8B6914" stroke-width="0.2" />

		<!-- Coordinate labels -->
		{#each Array(9) as _, c}
			<text x={8 + c * 10.5} y="4" text-anchor="middle" font-size="3" fill="#8B6914" class="select-none">
				{String.fromCharCode(97 + c)}
			</text>
		{/each}
		{#each Array(10) as _, r}
			<text x="3" y={8 + r * 10.5 + 1} text-anchor="middle" font-size="3" fill="#8B6914" class="select-none">
				{10 - r}
			</text>
		{/each}

		<!-- Click targets and pieces -->
		{#each Array(10) as _, row}
			{#each Array(9) as _, col}
				{@const cx = 8 + col * 10.5}
				{@const cy = 8 + row * 10.5}
				{@const piece = grid[row]?.[col] ?? ""}

				<!-- Click target -->
				<rect
					x={cx - 5} y={cy - 5}
					width="10" height="10"
					fill="transparent"
					class="cursor-pointer"
					onclick={() => handleClick(col, row)}
					role="button"
					tabindex="-1"
				/>

				<!-- Highlights -->
				{#if isLastMove(col, row)}
					<circle cx={cx} cy={cy} r="4.8" fill="rgba(56, 189, 248, 0.2)" />
				{/if}
				{#if isSelected(col, row)}
					<circle cx={cx} cy={cy} r="4.8" fill="rgba(56, 189, 248, 0.35)" />
				{/if}
				{#if isDest(col, row)}
					<circle cx={cx} cy={cy} r={piece ? 4.8 : 1.8}
						fill={piece ? "transparent" : "rgba(56, 189, 248, 0.5)"}
						stroke={piece ? "rgba(56, 189, 248, 0.6)" : "none"}
						stroke-width="0.5"
					/>
				{/if}

				<!-- Piece -->
				{#if piece && PIECE_DISPLAY[piece]}
					{@const p = PIECE_DISPLAY[piece]}
					<circle cx={cx} cy={cy} r="4.2" fill="#FFF8E7" stroke={p.color} stroke-width="0.5" />
					<text
						x={cx} y={cy + 1.5}
						text-anchor="middle"
						font-size="5"
						font-weight="bold"
						fill={p.color}
						class="select-none"
					>{p.char}</text>
				{/if}
			{/each}
		{/each}
		<!-- Suggestion arrows -->
		{#each arrows as [fromSq, toSq], i}
			{@const f = sqToSvg(fromSq)}
			{@const t = sqToSvg(toSq)}
			{#if f && t}
				<line
					x1={f.x} y1={f.y} x2={t.x} y2={t.y}
					stroke={i === 0 ? "rgba(34,197,94,0.6)" : "rgba(59,130,246,0.4)"}
					stroke-width="1.5"
					stroke-linecap="round"
					marker-end="url(#arrowhead)"
				/>
			{/if}
		{/each}

		<defs>
			<marker id="arrowhead" markerWidth="4" markerHeight="3" refX="3" refY="1.5" orient="auto">
				<polygon points="0 0, 4 1.5, 0 3" fill="rgba(34,197,94,0.8)" />
			</marker>
		</defs>
	</svg>
</div>

<style>
	.janggi-wrap {
		aspect-ratio: 9 / 10;
		height: 100%;
		position: relative;
	}

	.janggi-board {
		width: 100%;
		height: 100%;
	}

	.select-none {
		user-select: none;
		pointer-events: none;
	}
</style>

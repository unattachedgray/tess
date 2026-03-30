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

	const flipped = $derived(orientation === "black");

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
		if (flipped) {
			result.reverse();
			for (const row of result) row.reverse();
		}
		return result;
	});

	const PIECE_DISPLAY: Record<string, { char: string; color: string }> = {
		R: { char: "車", color: "#1a5fb4" }, N: { char: "馬", color: "#1a5fb4" },
		B: { char: "象", color: "#1a5fb4" }, A: { char: "士", color: "#1a5fb4" },
		K: { char: "將", color: "#1a5fb4" }, C: { char: "砲", color: "#1a5fb4" },
		P: { char: "兵", color: "#1a5fb4" },
		r: { char: "車", color: "#c01c28" }, n: { char: "馬", color: "#c01c28" },
		b: { char: "象", color: "#c01c28" }, a: { char: "士", color: "#c01c28" },
		k: { char: "將", color: "#c01c28" }, c: { char: "砲", color: "#c01c28" },
		p: { char: "卒", color: "#c01c28" },
	};

	function sqToSvg(sq: string): { x: number; y: number } | null {
		const col = sq.charCodeAt(0) - 97;
		const rank = parseInt(sq.slice(1), 10);
		const row = 10 - rank;
		if (col < 0 || col > 8 || row < 0 || row > 9) return null;
		const dc = flipped ? 8 - col : col;
		const dr = flipped ? 9 - row : row;
		return { x: 8 + dc * 10.5, y: 8 + dr * 10.5 };
	}

	function toSquare(col: number, row: number): string {
		const c = flipped ? 8 - col : col;
		const r = flipped ? 9 - row : row;
		return `${String.fromCharCode(97 + c)}${10 - r}`;
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
	<svg viewBox="-2 0 104 110" class="janggi-board">
		<rect x="-2" width="104" height="110" fill="#E8C07A" rx="2" />

		<!-- Grid -->
		{#each Array(9) as _, c}
			<line x1={8 + c * 10.5} y1={8} x2={8 + c * 10.5} y2={8 + 9 * 10.5} stroke="#8B6914" stroke-width="0.3" />
		{/each}
		{#each Array(10) as _, r}
			<line x1={8} y1={8 + r * 10.5} x2={8 + 8 * 10.5} y2={8 + r * 10.5} stroke="#8B6914" stroke-width="0.3" />
		{/each}

		<!-- Palace diagonals -->
		<line x1={8 + 3 * 10.5} y1={8} x2={8 + 5 * 10.5} y2={8 + 2 * 10.5} stroke="#8B6914" stroke-width="0.2" />
		<line x1={8 + 5 * 10.5} y1={8} x2={8 + 3 * 10.5} y2={8 + 2 * 10.5} stroke="#8B6914" stroke-width="0.2" />
		<line x1={8 + 3 * 10.5} y1={8 + 7 * 10.5} x2={8 + 5 * 10.5} y2={8 + 9 * 10.5} stroke="#8B6914" stroke-width="0.2" />
		<line x1={8 + 5 * 10.5} y1={8 + 7 * 10.5} x2={8 + 3 * 10.5} y2={8 + 9 * 10.5} stroke="#8B6914" stroke-width="0.2" />

		<!-- Coordinates -->
		{#each Array(9) as _, c}
			<text x={8 + c * 10.5} y="4" text-anchor="middle" font-size="3" fill="#8B6914" style="pointer-events:none;user-select:none">{String.fromCharCode(97 + (flipped ? 8 - c : c))}</text>
		{/each}
		{#each Array(10) as _, r}
			<text x="3" y={8 + r * 10.5 + 1} text-anchor="middle" font-size="3" fill="#8B6914" style="pointer-events:none;user-select:none">{flipped ? r + 1 : 10 - r}</text>
		{/each}

		<!-- Visual elements (all pointer-events:none) -->
		{#each Array(10) as _, row}
			{#each Array(9) as _, col}
				{@const cx = 8 + col * 10.5}
				{@const cy = 8 + row * 10.5}
				{@const piece = grid[row]?.[col] ?? ""}

				{#if isLastMove(col, row)}
					<circle cx={cx} cy={cy} r="4.8" fill="rgba(56, 189, 248, 0.2)" style="pointer-events:none" />
				{/if}
				{#if isSelected(col, row)}
					<circle cx={cx} cy={cy} r="4.8" fill="rgba(56, 189, 248, 0.35)" style="pointer-events:none" />
				{/if}
				{#if isDest(col, row)}
					<circle cx={cx} cy={cy} r={piece ? 4.8 : 1.8}
						fill={piece ? "transparent" : "rgba(56, 189, 248, 0.5)"}
						stroke={piece ? "rgba(56, 189, 248, 0.6)" : "none"}
						stroke-width="0.5" style="pointer-events:none" />
				{/if}

				{#if piece && PIECE_DISPLAY[piece]}
					{@const p = PIECE_DISPLAY[piece]}
					<circle cx={cx} cy={cy} r="4.2" fill="#FFF8E7" stroke={p.color} stroke-width="0.5" style="pointer-events:none" />
					<text x={cx} y={cy + 1.5} text-anchor="middle" font-size="5" font-weight="bold" fill={p.color} style="pointer-events:none;user-select:none">{p.char}</text>
				{/if}
			{/each}
		{/each}

		<!-- Arrows -->
		{#each arrows as [fromSq, toSq], i}
			{@const f = sqToSvg(fromSq)}
			{@const t = sqToSvg(toSq)}
			{#if f && t}
				<line x1={f.x} y1={f.y} x2={t.x} y2={t.y}
					stroke={i === 0 ? "rgba(34,197,94,0.6)" : "rgba(59,130,246,0.4)"}
					stroke-width="1.5" stroke-linecap="round" marker-end="url(#arrowhead)"
					style="pointer-events:none" />
			{/if}
		{/each}
		<defs>
			<marker id="arrowhead" markerWidth="4" markerHeight="3" refX="3" refY="1.5" orient="auto">
				<polygon points="0 0, 4 1.5, 0 3" fill="rgba(34,197,94,0.8)" />
			</marker>
		</defs>

		<!-- Click targets (LAST - on top of everything) -->
		{#each Array(10) as _, row}
			{#each Array(9) as _, col}
				<rect
					x={8 + col * 10.5 - 5} y={8 + row * 10.5 - 5}
					width="10" height="10" fill="transparent"
					class="cursor-pointer"
					onclick={() => handleClick(col, row)}
					onkeydown={() => {}}
					role="button" tabindex="-1"
				/>
			{/each}
		{/each}
	</svg>
</div>

<style>
	.janggi-wrap { aspect-ratio: 10 / 11; height: 100%; position: relative; }
	.janggi-board { width: 100%; height: 100%; overflow: visible; }
</style>

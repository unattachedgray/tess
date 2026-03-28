/**
 * Janggi (Korean Chess) game logic.
 * Board: 9 columns (a-i) × 10 rows (1-10)
 * Blue (uppercase, 'w' turn) vs Red (lowercase, 'b' turn)
 * FEN pieces: R=Chariot, N=Horse, B=Elephant, A=Advisor, K=King, C=Cannon, P=Soldier
 */

const STARTING_FEN = "rnba1abnr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ABNR w - - 0 1";

const PIECE_NAMES: Record<string, string> = {
	R: "車",
	N: "馬",
	B: "象",
	A: "士",
	K: "將",
	C: "砲",
	P: "兵",
	r: "車",
	n: "馬",
	b: "象",
	a: "士",
	k: "將",
	c: "砲",
	p: "卒",
};

export class JanggiGame {
	private _fen: string;
	private _turn: "w" | "b";
	private _moveHistory: { from: string; to: string; piece: string; captured?: string }[] = [];
	private _isGameOver = false;
	private _isCheckmate = false;
	private _capturedByBlue: string[] = [];
	private _capturedByRed: string[] = [];

	constructor(fen?: string) {
		this._fen = fen ?? STARTING_FEN;
		this._turn = this._fen.split(" ")[1] as "w" | "b";
	}

	get fen(): string {
		return this._fen;
	}

	get turn(): "white" | "black" {
		return this._turn === "w" ? "white" : "black";
	}

	get moveCount(): number {
		return this._moveHistory.length;
	}

	get isGameOver(): boolean {
		return this._isGameOver;
	}

	get isCheckmate(): boolean {
		return this._isCheckmate;
	}

	// --- Move execution ---

	move(from: string, to: string): { from: string; to: string } | null {
		const grid = this.fenToGrid();
		const [c1, r1] = this.squareToIndex(from);
		const [c2, r2] = this.squareToIndex(to);
		if (c1 < 0 || c2 < 0) return null;

		const piece = grid[r1][c1];
		if (piece === "1") return null;

		// Must be current player's piece
		if (this._turn === "w" ? !this.isBlue(piece) : !this.isRed(piece)) return null;

		// Validate geometry
		const target = grid[r2][c2];
		if (target !== "1" && this.sameColor(piece, target)) return null;
		if (!this.isValidGeometry(piece, c1, r1, c2, r2, grid)) return null;

		// Execute move
		const captured = target !== "1" ? target : undefined;
		grid[r2][c2] = piece;
		grid[r1][c1] = "1";

		// Check if own king is in check after move — illegal
		if (this.isKingInCheck(this._turn, grid)) {
			// Undo
			grid[r1][c1] = piece;
			grid[r2][c2] = target;
			return null;
		}

		// Commit
		if (captured) {
			const name = PIECE_NAMES[captured] ?? captured;
			if (this.isBlue(piece)) {
				this._capturedByBlue.push(name);
			} else {
				this._capturedByRed.push(name);
			}

			if (captured.toLowerCase() === "k") {
				this._isGameOver = true;
				this._isCheckmate = true;
			}
		}

		this._moveHistory.push({ from, to, piece, captured });
		this._fen = this.gridToFen(grid, this._turn === "w" ? "b" : "w");
		this._turn = this._turn === "w" ? "b" : "w";

		return { from, to };
	}

	moveUci(uci: string): { from: string; to: string } | null {
		if (uci.length < 4) return null;
		const from = uci.slice(0, 2);
		const to = uci.slice(2, 4);
		return this.move(from, to);
	}

	// --- Legal move generation ---

	getLegalMoves(): Map<string, string[]> {
		const grid = this.fenToGrid();
		const dests = new Map<string, string[]>();

		for (let r = 0; r < 10; r++) {
			for (let c = 0; c < 9; c++) {
				const piece = grid[r][c];
				if (piece === "1") continue;
				if (this._turn === "w" ? !this.isBlue(piece) : !this.isRed(piece)) continue;

				const from = this.indexToSquare(c, r);
				const targets = this.getValidDestinations(c, r, piece, grid);
				if (targets.length > 0) {
					dests.set(from, targets);
				}
			}
		}
		return dests;
	}

	getLegalMovesObject(): Record<string, string[]> {
		const dests = this.getLegalMoves();
		const obj: Record<string, string[]> = {};
		for (const [from, tos] of dests) {
			obj[from] = tos;
		}
		return obj;
	}

	private getValidDestinations(c1: number, r1: number, piece: string, grid: string[][]): string[] {
		const targets: string[] = [];
		for (let r2 = 0; r2 < 10; r2++) {
			for (let c2 = 0; c2 < 9; c2++) {
				if (c1 === c2 && r1 === r2) continue;
				const target = grid[r2][c2];
				if (target !== "1" && this.sameColor(piece, target)) continue;
				if (!this.isValidGeometry(piece, c1, r1, c2, r2, grid)) continue;

				// Simulate move and check if own king is safe
				const saved = grid[r2][c2];
				grid[r2][c2] = piece;
				grid[r1][c1] = "1";
				const inCheck = this.isKingInCheck(this._turn, grid);
				grid[r1][c1] = piece;
				grid[r2][c2] = saved;

				if (!inCheck) {
					targets.push(this.indexToSquare(c2, r2));
				}
			}
		}
		return targets;
	}

	// --- Piece movement geometry ---

	private isValidGeometry(
		piece: string,
		c1: number,
		r1: number,
		c2: number,
		r2: number,
		grid: string[][],
	): boolean {
		const dx = Math.abs(c2 - c1);
		const dy = Math.abs(r2 - r1);
		const target = grid[r2][c2];
		const type = piece.toLowerCase();

		switch (type) {
			case "r": // Chariot — orthogonal any distance; diagonal in palace
				if (dx === 0 || dy === 0) return this.isPathClear(c1, r1, c2, r2, grid);
				if (this.inPalace(c1, r1) && this.inPalace(c2, r2) && dx === dy && dx <= 2) {
					return this.isDiagonalClear(c1, r1, c2, r2, grid);
				}
				return false;

			case "n": {
				// Horse — L-shape with pivot
				if (!((dx === 1 && dy === 2) || (dx === 2 && dy === 1))) return false;
				let pX = c1;
				let pY = r1;
				if (dy > dx) pY += r2 > r1 ? 1 : -1;
				else pX += c2 > c1 ? 1 : -1;
				return grid[pY][pX] === "1";
			}

			case "b": {
				// Elephant — 2+3 or 3+2 with two pivots
				if (!((dx === 2 && dy === 3) || (dx === 3 && dy === 2))) return false;
				const sx = Math.sign(c2 - c1);
				const sy = Math.sign(r2 - r1);
				let px: number;
				let py: number;
				if (dy > dx) {
					px = c1;
					py = r1 + sy;
				} else {
					px = c1 + sx;
					py = r1;
				}
				if (grid[py][px] !== "1") return false;
				px += sx;
				py += sy;
				return grid[py][px] === "1";
			}

			case "a": // Advisor — palace only, 1 step
				if (!this.inPalace(c2, r2)) return false;
				if (dx + dy === 1) return true;
				if (dx === 1 && dy === 1) {
					return this.isPalaceCenter(c1, r1) || this.isPalaceCenter(c2, r2);
				}
				return false;

			case "k": // King — palace only, 1 step (same as advisor)
				if (!this.inPalace(c2, r2)) return false;
				if (dx + dy === 1) return true;
				if (dx === 1 && dy === 1) {
					return this.isPalaceCenter(c1, r1) || this.isPalaceCenter(c2, r2);
				}
				return false;

			case "c": {
				// Cannon — orthogonal/palace-diagonal, must jump exactly 1 piece
				const isOrthogonal = dx === 0 || dy === 0;
				const isPalaceDiag = this.inPalace(c1, r1) && this.inPalace(c2, r2) && dx === dy;
				if (!isOrthogonal && !isPalaceDiag) return false;
				if (this.countObstacles(c1, r1, c2, r2, grid) !== 1) return false;
				// Can't jump over or land on cannons
				const screen = this.getScreen(c1, r1, c2, r2, grid);
				if (screen?.toLowerCase() === "c") return false;
				if (target !== "1" && target.toLowerCase() === "c") return false;
				return true;
			}

			case "p": {
				// Soldier — forward or sideways; diagonal forward in palace
				const isRed = this.isRed(piece);
				const forward = isRed ? 1 : -1; // Red moves down (row++), Blue moves up (row--)
				if (dx + dy === 1) {
					if (dx === 1 && dy === 0) return true; // sideways
					if (dy === 1 && r2 - r1 === forward) return true; // forward
					return false;
				}
				if (this.inPalace(c1, r1) && this.inPalace(c2, r2)) {
					if (dx === 1 && dy === 1 && r2 - r1 === forward) return true;
				}
				return false;
			}

			default:
				return false;
		}
	}

	// --- Path/obstacle helpers ---

	private isPathClear(c1: number, r1: number, c2: number, r2: number, grid: string[][]): boolean {
		const sx = Math.sign(c2 - c1);
		const sy = Math.sign(r2 - r1);
		let cx = c1 + sx;
		let cy = r1 + sy;
		while (cx !== c2 || cy !== r2) {
			if (grid[cy][cx] !== "1") return false;
			cx += sx;
			cy += sy;
		}
		return true;
	}

	private isDiagonalClear(
		c1: number,
		r1: number,
		c2: number,
		r2: number,
		grid: string[][],
	): boolean {
		const sx = Math.sign(c2 - c1);
		const sy = Math.sign(r2 - r1);
		let cx = c1 + sx;
		let cy = r1 + sy;
		while (cx !== c2 || cy !== r2) {
			if (grid[cy][cx] !== "1") return false;
			cx += sx;
			cy += sy;
		}
		return true;
	}

	private countObstacles(c1: number, r1: number, c2: number, r2: number, grid: string[][]): number {
		const sx = Math.sign(c2 - c1);
		const sy = Math.sign(r2 - r1);
		let cx = c1 + sx;
		let cy = r1 + sy;
		let count = 0;
		while (cx !== c2 || cy !== r2) {
			if (grid[cy][cx] !== "1") count++;
			cx += sx;
			cy += sy;
		}
		return count;
	}

	private getScreen(
		c1: number,
		r1: number,
		c2: number,
		r2: number,
		grid: string[][],
	): string | null {
		const sx = Math.sign(c2 - c1);
		const sy = Math.sign(r2 - r1);
		let cx = c1 + sx;
		let cy = r1 + sy;
		while (cx !== c2 || cy !== r2) {
			if (grid[cy][cx] !== "1") return grid[cy][cx];
			cx += sx;
			cy += sy;
		}
		return null;
	}

	// --- Palace helpers ---

	private inPalace(c: number, r: number): boolean {
		if (c < 3 || c > 5) return false;
		return (r >= 0 && r <= 2) || (r >= 7 && r <= 9);
	}

	private isPalaceCenter(c: number, r: number): boolean {
		return c === 4 && (r === 1 || r === 8);
	}

	// --- Check detection ---

	isKingInCheck(color: "w" | "b", grid: string[][]): boolean {
		const kingChar = color === "w" ? "K" : "k";
		let kc = -1;
		let kr = -1;

		for (let r = 0; r < 10; r++) {
			for (let c = 0; c < 9; c++) {
				if (grid[r][c] === kingChar) {
					kc = c;
					kr = r;
					break;
				}
			}
			if (kc >= 0) break;
		}
		if (kc < 0) return false;

		for (let r = 0; r < 10; r++) {
			for (let c = 0; c < 9; c++) {
				const p = grid[r][c];
				if (p === "1") continue;
				const isEnemy = color === "w" ? this.isRed(p) : this.isBlue(p);
				if (!isEnemy) continue;
				if (this.isValidGeometry(p, c, r, kc, kr, grid)) return true;
			}
		}
		return false;
	}

	forceGameOver(): void {
		if (this._isGameOver) return;
		this._isGameOver = true;
		const grid = this.fenToGrid();
		this._isCheckmate = this.isKingInCheck(this._turn, grid);
	}

	// --- State accessors ---

	getCapturedPieces(): { blue: string[]; red: string[] } {
		return {
			blue: [...this._capturedByBlue],
			red: [...this._capturedByRed],
		};
	}

	getGameResult(): { winner: "white" | "black" | "draw"; reason: string } | null {
		if (!this._isGameOver) return null;
		if (this._isCheckmate) {
			const winner = this._turn === "w" ? "black" : "white";
			return { winner, reason: "checkmate" };
		}
		return { winner: "draw", reason: "stalemate" };
	}

	getMoveHistory(): { san: string; uci: string; fen: string; moveNumber: number }[] {
		return this._moveHistory.map((m, i) => ({
			san: `${m.piece}${m.from}${m.captured ? "x" : "-"}${m.to}`,
			uci: `${m.from}${m.to}`,
			fen: this._fen, // simplified — would need per-move FEN for full support
			moveNumber: i + 1,
		}));
	}

	// --- Color helpers ---

	private isBlue(p: string): boolean {
		return p >= "A" && p <= "Z";
	}

	private isRed(p: string): boolean {
		return p >= "a" && p <= "z";
	}

	private sameColor(a: string, b: string): boolean {
		return (this.isBlue(a) && this.isBlue(b)) || (this.isRed(a) && this.isRed(b));
	}

	// --- FEN ↔ Grid ---

	fenToGrid(): string[][] {
		const rows = this._fen.split(" ")[0].split("/");
		const grid: string[][] = [];
		for (const row of rows) {
			const gridRow: string[] = [];
			for (const ch of row) {
				const n = Number.parseInt(ch, 10);
				if (!Number.isNaN(n)) {
					for (let i = 0; i < n; i++) gridRow.push("1");
				} else {
					gridRow.push(ch);
				}
			}
			grid.push(gridRow);
		}
		return grid;
	}

	private gridToFen(grid: string[][], turn: "w" | "b"): string {
		const rows: string[] = [];
		for (const row of grid) {
			let fenRow = "";
			let empty = 0;
			for (const cell of row) {
				if (cell === "1") {
					empty++;
				} else {
					if (empty > 0) {
						fenRow += empty;
						empty = 0;
					}
					fenRow += cell;
				}
			}
			if (empty > 0) fenRow += empty;
			rows.push(fenRow);
		}
		return `${rows.join("/")} ${turn} - - 0 1`;
	}

	// --- Coordinate conversion ---

	private squareToIndex(sq: string): [number, number] {
		if (sq.length < 2) return [-1, -1];
		const col = sq.charCodeAt(0) - "a".charCodeAt(0);
		const row = 10 - Number.parseInt(sq.slice(1), 10);
		if (col < 0 || col > 8 || row < 0 || row > 9) return [-1, -1];
		return [col, row];
	}

	private indexToSquare(c: number, r: number): string {
		return `${String.fromCharCode("a".charCodeAt(0) + c)}${10 - r}`;
	}

	reset(): void {
		this._fen = STARTING_FEN;
		this._turn = "w";
		this._moveHistory = [];
		this._isGameOver = false;
		this._isCheckmate = false;
		this._capturedByBlue = [];
		this._capturedByRed = [];
	}
}

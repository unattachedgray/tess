export type StoneColor = "black" | "white" | null;

const COL_CHARS = "ABCDEFGHJKLMNOPQRST"; // No 'I' in Go notation

export class GoGame {
	readonly size: number;
	private board: StoneColor[][];
	private _turn: StoneColor & string = "black";
	private _moveHistory: { color: string; coord: string }[] = [];
	private _prisoners: { black: number; white: number } = { black: 0, white: 0 };
	private _gameOver = false;
	private _resigned: string | null = null;
	private _lastMove: { x: number; y: number } | null = null;
	private _lastCaptures: { x: number; y: number }[] = [];
	private _consecutivePasses = 0;
	private _prevBoardHash: string | null = null;

	constructor(size = 19) {
		if (size !== 9 && size !== 13 && size !== 19) {
			throw new Error("Board size must be 9, 13, or 19");
		}
		this.size = size;
		this.board = Array.from({ length: size }, () => Array<StoneColor>(size).fill(null));
	}

	get turn(): "black" | "white" {
		return this._turn;
	}

	get moveCount(): number {
		return this._moveHistory.length;
	}

	get isGameOver(): boolean {
		return this._gameOver;
	}

	get prisoners(): { black: number; white: number } {
		return { ...this._prisoners };
	}

	get lastMove(): { x: number; y: number } | null {
		return this._lastMove;
	}

	get lastCaptures(): { x: number; y: number }[] {
		return [...this._lastCaptures];
	}

	getStone(x: number, y: number): StoneColor {
		if (x < 0 || x >= this.size || y < 0 || y >= this.size) return null;
		return this.board[y][x];
	}

	play(x: number, y: number): boolean {
		if (this._gameOver) return false;
		if (x < 0 || x >= this.size || y < 0 || y >= this.size) return false;
		if (this.board[y][x] !== null) return false;

		const opponent = this._turn === "black" ? "white" : "black";
		const prevHash = this.boardHash();

		// Place stone tentatively
		this.board[y][x] = this._turn;

		// Capture opponent groups with no liberties
		const captured: { x: number; y: number }[] = [];
		for (const [nx, ny] of this.neighbors(x, y)) {
			if (this.board[ny][nx] === opponent) {
				const group = this.getGroup(nx, ny);
				if (this.countLiberties(group) === 0) {
					for (const stone of group) {
						this.board[stone.y][stone.x] = null;
						captured.push(stone);
					}
				}
			}
		}

		// Check suicide: own group must have liberties after captures
		const ownGroup = this.getGroup(x, y);
		if (this.countLiberties(ownGroup) === 0) {
			// Undo: restore board
			this.board[y][x] = null;
			for (const stone of captured) {
				this.board[stone.y][stone.x] = opponent;
			}
			return false;
		}

		// Check Ko: board can't return to previous state with single capture
		if (captured.length === 1 && this.boardHash() === this._prevBoardHash) {
			// Undo
			this.board[y][x] = null;
			for (const stone of captured) {
				this.board[stone.y][stone.x] = opponent;
			}
			return false;
		}

		// Move is legal — commit
		this._prevBoardHash = prevHash;
		this._lastMove = { x, y };
		this._lastCaptures = captured;
		this._consecutivePasses = 0;

		// Update prisoners
		if (this._turn === "black") {
			this._prisoners.black += captured.length;
		} else {
			this._prisoners.white += captured.length;
		}

		const coord = this.toGtpCoord(x, y);
		this._moveHistory.push({ color: this._turn, coord });
		this._turn = opponent;

		return true;
	}

	pass(): boolean {
		if (this._gameOver) return false;

		this._moveHistory.push({ color: this._turn, coord: "PASS" });
		this._consecutivePasses++;
		this._lastMove = null;
		this._lastCaptures = [];

		if (this._consecutivePasses >= 2) {
			this._gameOver = true;
		}

		this._turn = this._turn === "black" ? "white" : "black";
		return true;
	}

	resign(color: string): void {
		this._gameOver = true;
		this._resigned = color;
	}

	playGtp(coord: string, _color?: string): boolean {
		if (coord.toUpperCase() === "PASS") {
			return this.pass();
		}
		const parsed = this.fromGtpCoord(coord);
		if (!parsed) return false;
		return this.play(parsed.x, parsed.y);
	}

	// Board queries

	getGroup(x: number, y: number): { x: number; y: number }[] {
		const color = this.board[y][x];
		if (color === null) return [];

		const group: { x: number; y: number }[] = [];
		const visited = new Set<string>();
		const stack: [number, number][] = [[x, y]];

		while (stack.length > 0) {
			const [cx, cy] = stack.pop()!;
			const key = `${cx},${cy}`;
			if (visited.has(key)) continue;
			visited.add(key);

			if (this.board[cy][cx] !== color) continue;
			group.push({ x: cx, y: cy });

			for (const [nx, ny] of this.neighbors(cx, cy)) {
				if (!visited.has(`${nx},${ny}`)) {
					stack.push([nx, ny]);
				}
			}
		}

		return group;
	}

	countLiberties(group: { x: number; y: number }[]): number {
		const liberties = new Set<string>();
		for (const stone of group) {
			for (const [nx, ny] of this.neighbors(stone.x, stone.y)) {
				if (this.board[ny][nx] === null) {
					liberties.add(`${nx},${ny}`);
				}
			}
		}
		return liberties.size;
	}

	private neighbors(x: number, y: number): [number, number][] {
		const result: [number, number][] = [];
		if (x > 0) result.push([x - 1, y]);
		if (x < this.size - 1) result.push([x + 1, y]);
		if (y > 0) result.push([x, y - 1]);
		if (y < this.size - 1) result.push([x, y + 1]);
		return result;
	}

	boardHash(): string {
		let hash = "";
		for (let y = 0; y < this.size; y++) {
			for (let x = 0; x < this.size; x++) {
				const s = this.board[y][x];
				hash += s === "black" ? "B" : s === "white" ? "W" : ".";
			}
		}
		return hash;
	}

	// Coordinate conversion

	toGtpCoord(x: number, y: number): string {
		return `${COL_CHARS[x]}${this.size - y}`;
	}

	fromGtpCoord(coord: string): { x: number; y: number } | null {
		if (!coord || coord.length < 2) return null;
		const col = coord[0].toUpperCase();
		const x = COL_CHARS.indexOf(col);
		if (x < 0) return null;
		const row = Number.parseInt(coord.slice(1), 10);
		if (Number.isNaN(row) || row < 1 || row > this.size) return null;
		return { x, y: this.size - row };
	}

	// State accessors

	getGameResult(): { winner: "black" | "white" | "draw"; reason: string } | null {
		if (!this._gameOver) return null;
		if (this._resigned) {
			const winner = this._resigned === "black" ? "white" : "black";
			return { winner, reason: "resignation" };
		}
		return { winner: "draw", reason: "double pass" };
	}

	getMoveHistory(): { color: string; coord: string; moveNumber: number }[] {
		return this._moveHistory.map((m, i) => ({
			...m,
			moveNumber: i + 1,
		}));
	}

	/** Returns moves in KataGo analysis format: [["B", "Q16"], ["W", "D4"]] */
	getKataGoMoves(): [string, string][] {
		return this._moveHistory
			.filter((m) => m.coord !== "PASS")
			.map((m) => [m.color === "black" ? "B" : "W", m.coord]);
	}

	getStoneCounts(): { black: number; white: number } {
		let black = 0;
		let white = 0;
		for (let y = 0; y < this.size; y++) {
			for (let x = 0; x < this.size; x++) {
				if (this.board[y][x] === "black") black++;
				else if (this.board[y][x] === "white") white++;
			}
		}
		return { black, white };
	}

	/** Serialize board state for client */
	getBoardState(): StoneColor[][] {
		return this.board.map((row) => [...row]);
	}

	reset(): void {
		this.board = Array.from({ length: this.size }, () => Array<StoneColor>(this.size).fill(null));
		this._turn = "black";
		this._moveHistory = [];
		this._prisoners = { black: 0, white: 0 };
		this._gameOver = false;
		this._resigned = null;
		this._lastMove = null;
		this._lastCaptures = [];
		this._consecutivePasses = 0;
		this._prevBoardHash = null;
	}
}

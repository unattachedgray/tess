import { Chess, type Move, type Square } from "chess.js";

const STARTING_PIECES: Record<string, number> = {
	p: 8,
	r: 2,
	n: 2,
	b: 2,
	q: 1,
	k: 1,
	P: 8,
	R: 2,
	N: 2,
	B: 2,
	Q: 1,
	K: 1,
};

export class ChessGame {
	private chess: Chess;
	private moves: Move[] = [];

	constructor(fen?: string) {
		this.chess = new Chess(fen);
	}

	get fen(): string {
		return this.chess.fen();
	}

	get pgn(): string {
		return this.chess.pgn();
	}

	get turn(): "white" | "black" {
		return this.chess.turn() === "w" ? "white" : "black";
	}

	get moveCount(): number {
		return this.moves.length;
	}

	get isGameOver(): boolean {
		return this.chess.isGameOver();
	}

	get isCheck(): boolean {
		return this.chess.isCheck();
	}

	get isCheckmate(): boolean {
		return this.chess.isCheckmate();
	}

	get isDraw(): boolean {
		return this.chess.isDraw();
	}

	get isStalemate(): boolean {
		return this.chess.isStalemate();
	}

	move(from: string, to: string, promotion?: string): Move | null {
		try {
			const result = this.chess.move({ from: from as Square, to: to as Square, promotion });
			if (result) this.moves.push(result);
			return result;
		} catch {
			return null;
		}
	}

	moveUci(uci: string): Move | null {
		const from = uci.slice(0, 2);
		const to = uci.slice(2, 4);
		let promotion = uci.length > 4 ? uci[4] : undefined;
		// Auto-promote to queen if no promotion specified but move requires it
		if (!promotion && this.isPromotion(from, to)) {
			promotion = "q";
		}
		return this.move(from, to, promotion);
	}

	uciToSan(uci: string): string | null {
		const clone = new Chess(this.fen);
		try {
			const m = clone.move({
				from: uci.slice(0, 2) as Square,
				to: uci.slice(2, 4) as Square,
				promotion: uci.length > 4 ? uci[4] : undefined,
			});
			return m?.san ?? null;
		} catch {
			return null;
		}
	}

	getLegalMoves(): Map<string, string[]> {
		const dests = new Map<string, string[]>();
		const moves = this.chess.moves({ verbose: true });
		for (const m of moves) {
			const existing = dests.get(m.from) ?? [];
			existing.push(m.to);
			dests.set(m.from, existing);
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

	getCapturedPieces(): { white: string[]; black: string[] } {
		const current: Record<string, number> = {};
		const board = this.chess.board();
		for (const row of board) {
			for (const sq of row) {
				if (!sq) continue;
				const key = sq.color === "w" ? sq.type.toUpperCase() : sq.type;
				current[key] = (current[key] ?? 0) + 1;
			}
		}

		const white: string[] = []; // pieces white has lost (captured by black)
		const black: string[] = []; // pieces black has lost (captured by white)

		for (const [piece, count] of Object.entries(STARTING_PIECES)) {
			const remaining = current[piece] ?? 0;
			const lost = count - remaining;
			const isWhite = piece === piece.toUpperCase();
			for (let i = 0; i < lost; i++) {
				if (isWhite) {
					white.push(piece.toLowerCase());
				} else {
					black.push(piece);
				}
			}
		}

		return { white, black };
	}

	getLastMove(): [string, string] | null {
		if (this.moves.length === 0) return null;
		const last = this.moves[this.moves.length - 1];
		return [last.from, last.to];
	}

	isPromotion(from: string, to: string): boolean {
		const moves = this.chess.moves({ verbose: true });
		return moves.some((m) => m.from === from && m.to === to && m.promotion);
	}

	getGameResult(): { winner: "white" | "black" | "draw"; reason: string } | null {
		if (!this.isGameOver) return null;

		if (this.isCheckmate) {
			const winner = this.turn === "white" ? "black" : "white";
			return { winner, reason: "checkmate" };
		}
		if (this.isStalemate) {
			return { winner: "draw", reason: "stalemate" };
		}
		if (this.chess.isThreefoldRepetition()) {
			return { winner: "draw", reason: "threefold repetition" };
		}
		if (this.chess.isInsufficientMaterial()) {
			return { winner: "draw", reason: "insufficient material" };
		}
		return { winner: "draw", reason: "draw" };
	}

	getMoveHistory(): { san: string; uci: string; fen: string; moveNumber: number }[] {
		return this.moves.map((m, i) => ({
			san: m.san,
			uci: `${m.from}${m.to}${m.promotion ?? ""}`,
			fen: m.after,
			moveNumber: i + 1,
		}));
	}

	reset(): void {
		this.chess.reset();
		this.moves = [];
	}
}

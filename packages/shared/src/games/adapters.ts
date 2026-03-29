/**
 * Game adapters — wrap existing game classes to implement IGame interface.
 *
 * These adapters let the existing ChessGame, GoGame, and JanggiGame work
 * with the new plugin system without modifying their internals.
 *
 * New games should implement IGame directly instead of using adapters.
 */

import type { IGame, MoveResult, PluginGameResult, GameSnapshot, GameDefinition } from "../game-interface.js";
import { GameRegistry } from "../game-interface.js";
import { ChessGame } from "./chess.js";
import { GoGame } from "./go.js";
import { JanggiGame } from "./janggi.js";

// ── Chess Adapter ──

export class ChessAdapter implements IGame {
	readonly variant = "chess";
	private game: ChessGame;

	constructor(fen?: string) {
		this.game = new ChessGame(fen);
	}

	get turn(): "white" | "black" { return this.game.turn; }
	get moveCount(): number { return this.game.moveCount; }
	get isGameOver(): boolean { return this.game.isGameOver; }

	move(notation: string): MoveResult | null {
		const result = this.game.moveUci(notation);
		if (!result) return null;
		return {
			notation: `${result.from}${result.to}${result.promotion ?? ""}`,
			display: result.san,
			position: this.game.fen,
			moveNumber: this.game.moveCount,
		};
	}

	getLegalMoves(): Record<string, string[]> {
		return this.game.getLegalMovesObject();
	}

	getResult(): PluginGameResult | null {
		return this.game.getGameResult();
	}

	getSnapshot(): GameSnapshot {
		const history = this.game.getMoveHistory();
		const captured = this.game.getCapturedPieces();
		return {
			fen: this.game.fen,
			turn: this.game.turn,
			legalMoves: this.game.getLegalMovesObject(),
			moveHistory: history.map((m) => ({
				notation: m.uci,
				display: m.san,
				position: m.fen,
				moveNumber: m.moveNumber,
			})),
			captured,
			extra: {
				isCheck: this.game.isCheck,
				isCheckmate: this.game.isCheckmate,
				isDraw: this.game.isDraw,
				isStalemate: this.game.isStalemate,
				pgn: this.game.pgn,
				uciToSan: (uci: string) => this.game.uciToSan(uci),
			},
		};
	}

	reset(): void { this.game.reset(); }

	/** Access the underlying ChessGame for engine-specific operations. */
	get inner(): ChessGame { return this.game; }
}

// ── Go Adapter ──

export class GoAdapter implements IGame {
	readonly variant: string;
	private game: GoGame;

	constructor(size = 19) {
		this.variant = `go-${size}`;
		this.game = new GoGame(size);
	}

	get turn(): "white" | "black" { return this.game.turn as "white" | "black"; }
	get moveCount(): number { return this.game.moveCount; }
	get isGameOver(): boolean { return this.game.isGameOver; }

	move(notation: string): MoveResult | null {
		if (notation.toUpperCase() === "PASS") {
			this.game.pass();
			return {
				notation: "PASS",
				display: "Pass",
				position: "",
				moveNumber: this.game.moveCount,
			};
		}
		const GO_COLS = "ABCDEFGHJKLMNOPQRST";
		const col = GO_COLS.indexOf(notation[0]?.toUpperCase());
		const row = parseInt(notation.slice(1), 10);
		if (col < 0 || isNaN(row)) return null;

		const y = this.game.size - row;
		const ok = this.game.play(col, y);
		if (!ok) return null;

		return {
			notation,
			display: notation.toUpperCase(),
			position: "",
			moveNumber: this.game.moveCount,
		};
	}

	getLegalMoves(): Record<string, string[]> {
		// Go doesn't have piece-based legal moves — any empty intersection is legal
		return {};
	}

	getResult(): PluginGameResult | null {
		return this.game.getGameResult?.() ?? null;
	}

	getSnapshot(): GameSnapshot {
		return {
			fen: "",
			boardState: this.game.getBoardState(),
			boardSize: this.game.size,
			turn: this.game.turn as "white" | "black",
			legalMoves: {},
			moveHistory: this.game.getMoveHistory().map((m) => ({
				notation: m.coord,
				display: m.coord,
				position: "",
				moveNumber: m.moveNumber,
			})),
			captured: { white: [], black: [] },
			extra: {
				prisoners: this.game.prisoners,
				lastMove: this.game.lastMove,
				kataGoMoves: this.game.getKataGoMoves(),
				size: this.game.size,
			},
		};
	}

	reset(): void {
		const size = this.game.size;
		this.game = new GoGame(size);
	}

	get inner(): GoGame { return this.game; }
}

// ── Janggi Adapter ──

export class JanggiAdapter implements IGame {
	readonly variant = "janggi";
	private game: JanggiGame;

	constructor(fen?: string) {
		this.game = new JanggiGame(fen);
	}

	get turn(): "white" | "black" { return this.game.turn; }
	get moveCount(): number { return this.game.moveCount; }
	get isGameOver(): boolean { return this.game.isGameOver; }

	move(notation: string): MoveResult | null {
		const result = this.game.moveUci(notation);
		if (!result) return null;
		return {
			notation,
			display: notation,
			position: this.game.fen,
			moveNumber: this.game.moveCount,
		};
	}

	getLegalMoves(): Record<string, string[]> {
		return this.game.getLegalMovesObject();
	}

	getResult(): PluginGameResult | null {
		return this.game.getGameResult?.() ?? null;
	}

	getSnapshot(): GameSnapshot {
		const history = this.game.getMoveHistory();
		const captured = this.game.getCapturedPieces();
		return {
			fen: this.game.fen,
			turn: this.game.turn,
			legalMoves: this.game.getLegalMovesObject(),
			moveHistory: history.map((m) => ({
				notation: m.uci ?? `${(m as any).from}${(m as any).to}`,
				display: m.san ?? m.uci ?? `${(m as any).from}${(m as any).to}`,
				position: this.game.fen,
				moveNumber: history.indexOf(m) + 1,
			})),
			captured: {
				white: (captured as any).white ?? (captured as any).blue ?? [],
				black: (captured as any).black ?? (captured as any).red ?? [],
			},
			extra: {
				isCheckmate: this.game.isCheckmate,
			},
		};
	}

	reset(): void {
		this.game = new JanggiGame();
	}

	get inner(): JanggiGame { return this.game; }
}

// ── Register built-in games ──

GameRegistry.register({
	variant: "chess",
	displayName: "Chess",
	family: "chess",
	create: (opts) => new ChessAdapter(opts?.fen as string | undefined),
	engine: { type: "fairy-stockfish", uciVariant: "chess" },
	board: { dimensions: [8, 8], pieceSet: "cburnett", coordinates: true },
	exportFormats: ["pgn", "fen"],
});

GameRegistry.register({
	variant: "go-9",
	displayName: "Go 9x9",
	family: "go",
	create: () => new GoAdapter(9),
	engine: { type: "katago" },
	board: { dimensions: [9] },
	exportFormats: ["sgf"],
});

GameRegistry.register({
	variant: "go-13",
	displayName: "Go 13x13",
	family: "go",
	create: () => new GoAdapter(13),
	engine: { type: "katago" },
	board: { dimensions: [13] },
	exportFormats: ["sgf"],
});

GameRegistry.register({
	variant: "go-19",
	displayName: "Go 19x19",
	family: "go",
	create: () => new GoAdapter(19),
	engine: { type: "katago" },
	board: { dimensions: [19] },
	exportFormats: ["sgf"],
});

GameRegistry.register({
	variant: "janggi",
	displayName: "Janggi",
	family: "chess",
	create: (opts) => new JanggiAdapter(opts?.fen as string | undefined),
	engine: { type: "fairy-stockfish", uciVariant: "janggi" },
	board: { dimensions: [9, 10], pieceSet: "janggi", coordinates: true },
	exportFormats: [],
});

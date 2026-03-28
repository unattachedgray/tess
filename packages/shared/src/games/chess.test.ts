import { describe, expect, it } from "vitest";
import { ChessGame } from "./chess.js";

describe("ChessGame", () => {
	it("starts with correct initial state", () => {
		const game = new ChessGame();
		expect(game.turn).toBe("white");
		expect(game.moveCount).toBe(0);
		expect(game.isGameOver).toBe(false);
		expect(game.isCheck).toBe(false);
	});

	it("makes valid moves", () => {
		const game = new ChessGame();
		const result = game.move("e2", "e4");
		expect(result).not.toBeNull();
		expect(game.turn).toBe("black");
		expect(game.moveCount).toBe(1);
	});

	it("rejects illegal moves", () => {
		const game = new ChessGame();
		const result = game.move("e2", "e5");
		expect(result).toBeNull();
	});

	it("handles UCI moves", () => {
		const game = new ChessGame();
		const result = game.moveUci("e2e4");
		expect(result).not.toBeNull();
		expect(game.turn).toBe("black");
	});

	it("detects check", () => {
		// Scholar's mate setup
		const game = new ChessGame();
		game.moveUci("e2e4");
		game.moveUci("e7e5");
		game.moveUci("d1h5");
		game.moveUci("b8c6");
		game.moveUci("f1c4");
		game.moveUci("g8f6");
		game.moveUci("h5f7"); // Checkmate
		expect(game.isCheckmate).toBe(true);
		expect(game.isGameOver).toBe(true);
		const result = game.getGameResult();
		expect(result?.winner).toBe("white");
		expect(result?.reason).toBe("checkmate");
	});

	it("tracks captured pieces", () => {
		const game = new ChessGame();
		game.moveUci("e2e4");
		game.moveUci("d7d5");
		game.moveUci("e4d5"); // capture
		const captured = game.getCapturedPieces();
		expect(captured.black).toContain("p");
		expect(captured.black.length).toBe(1);
	});

	it("provides legal moves", () => {
		const game = new ChessGame();
		const moves = game.getLegalMoves();
		expect(moves.size).toBeGreaterThan(0);
		expect(moves.get("e2")).toContain("e4");
	});

	it("provides move history", () => {
		const game = new ChessGame();
		game.moveUci("e2e4");
		game.moveUci("e7e5");
		const history = game.getMoveHistory();
		expect(history).toHaveLength(2);
		expect(history[0].san).toBe("e4");
		expect(history[0].uci).toBe("e2e4");
		expect(history[1].san).toBe("e5");
	});

	it("converts UCI to SAN", () => {
		const game = new ChessGame();
		expect(game.uciToSan("e2e4")).toBe("e4");
		expect(game.uciToSan("g1f3")).toBe("Nf3");
	});

	it("resets properly", () => {
		const game = new ChessGame();
		game.moveUci("e2e4");
		game.moveUci("e7e5");
		game.reset();
		expect(game.moveCount).toBe(0);
		expect(game.turn).toBe("white");
	});
});

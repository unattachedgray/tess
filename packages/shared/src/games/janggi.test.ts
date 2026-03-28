import { describe, expect, it } from "vitest";
import { JanggiGame } from "./janggi.js";

describe("JanggiGame", () => {
	it("starts with correct initial state", () => {
		const game = new JanggiGame();
		expect(game.turn).toBe("white"); // Blue goes first
		expect(game.moveCount).toBe(0);
		expect(game.isGameOver).toBe(false);
	});

	it("parses starting FEN to grid correctly", () => {
		const game = new JanggiGame();
		const grid = game.fenToGrid();
		expect(grid.length).toBe(10);
		expect(grid[0].length).toBe(9);
		// Red back rank
		expect(grid[0][0]).toBe("r"); // Red chariot
		expect(grid[0][4]).toBe("1"); // Empty center
		expect(grid[0][1]).toBe("n"); // Red horse
		// Blue back rank
		expect(grid[9][0]).toBe("R"); // Blue chariot
		expect(grid[9][4]).toBe("1"); // Empty
		// Kings
		expect(grid[1][4]).toBe("k"); // Red king at e9
		expect(grid[8][4]).toBe("K"); // Blue king at e2
	});

	it("makes a valid soldier move", () => {
		const game = new JanggiGame();
		// Blue soldier at c4 (grid row 6, col 2) moves forward to c5
		const result = game.moveUci("c4c5");
		expect(result).not.toBeNull();
		expect(game.turn).toBe("black");
	});

	it("rejects moving opponent's piece", () => {
		const game = new JanggiGame();
		// Try to move red piece on blue's turn
		const result = game.moveUci("a10a9");
		expect(result).toBeNull();
	});

	it("generates legal moves", () => {
		const game = new JanggiGame();
		const moves = game.getLegalMoves();
		expect(moves.size).toBeGreaterThan(0);
		// Blue soldiers at rank 4 should be able to move
		expect(moves.has("a4")).toBe(true);
	});

	it("tracks captured pieces", () => {
		// We'd need a specific position to test captures
		const game = new JanggiGame();
		const captured = game.getCapturedPieces();
		expect(captured.blue).toHaveLength(0);
		expect(captured.red).toHaveLength(0);
	});

	it("handles resignation", () => {
		const game = new JanggiGame();
		game.forceGameOver();
		expect(game.isGameOver).toBe(true);
	});

	it("resets properly", () => {
		const game = new JanggiGame();
		game.moveUci("c3c4");
		game.reset();
		expect(game.moveCount).toBe(0);
		expect(game.turn).toBe("white");
	});
});

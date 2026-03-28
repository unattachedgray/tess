/**
 * MCP (Model Context Protocol) Server for Tess.
 * Exposes board game engines as tools for Claude and other AI agents.
 *
 * Standard game notation:
 * - Chess: FEN positions, PGN game records, UCI/SAN move notation
 * - Go: GTP vertex notation (e.g., Q16), SGF format
 * - Janggi: FEN positions, algebraic coordinates (a1-i10)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ChessGame, GoGame, JanggiGame, detectOpening } from "@tess/shared";
import { z } from "zod";
import { createLogger } from "./logger.js";

const log = createLogger("mcp");

let currentGame: {
	type: "chess" | "go" | "janggi";
	chess?: ChessGame;
	go?: GoGame;
	janggi?: JanggiGame;
} | null = null;

export async function startMcpServer(): Promise<void> {
	const server = new McpServer({ name: "tess", version: "0.1.0" });

	// --- new_game ---
	server.tool(
		"new_game",
		"Start a new board game session. Returns the initial position in standard notation (FEN for Chess/Janggi, empty board for Go).",
		{
			game_type: z.enum(["chess", "go", "janggi"]).describe("Game type to play"),
			board_size: z.number().optional().describe("Go board size: 9, 13, or 19 (default 19)"),
		},
		async ({ game_type, board_size }) => {
			if (game_type === "chess") {
				currentGame = { type: "chess", chess: new ChessGame() };
			} else if (game_type === "go") {
				currentGame = { type: "go", go: new GoGame((board_size ?? 19) as 9 | 13 | 19) };
			} else {
				currentGame = { type: "janggi", janggi: new JanggiGame() };
			}
			return { content: [{ type: "text" as const, text: JSON.stringify(getPosition(), null, 2) }] };
		},
	);

	// --- play_move ---
	server.tool(
		"play_move",
		"Play a move on the board. Chess: UCI notation (e2e4) or SAN (e4, Nf3). Janggi: algebraic (a1a2). Go: GTP vertex (Q16, D4) or 'pass'.",
		{
			move: z.string().describe("Move in game-appropriate notation"),
		},
		async ({ move }) => {
			if (!currentGame) {
				return {
					content: [{ type: "text" as const, text: "No active game. Use new_game first." }],
				};
			}

			let success = false;
			if (currentGame.type === "chess" && currentGame.chess) {
				success = currentGame.chess.moveUci(move) !== null;
			} else if (currentGame.type === "go" && currentGame.go) {
				success =
					move.toUpperCase() === "PASS" ? currentGame.go.pass() : currentGame.go.playGtp(move);
			} else if (currentGame.type === "janggi" && currentGame.janggi) {
				success = currentGame.janggi.moveUci(move) !== null;
			}

			if (!success) {
				return { content: [{ type: "text" as const, text: `Illegal move: ${move}` }] };
			}
			return { content: [{ type: "text" as const, text: JSON.stringify(getPosition(), null, 2) }] };
		},
	);

	// --- get_position ---
	server.tool(
		"get_position",
		"Get the current board position in standard notation. Chess: FEN + PGN. Go: move list. Janggi: FEN. Includes legal moves and game status.",
		{},
		async () => {
			if (!currentGame) {
				return { content: [{ type: "text" as const, text: "No active game." }] };
			}
			return { content: [{ type: "text" as const, text: JSON.stringify(getPosition(), null, 2) }] };
		},
	);

	// --- get_legal_moves ---
	server.tool(
		"get_legal_moves",
		"List all legal moves in the current position. Chess: returns moves per square in UCI format. Janggi: same. Go: any empty intersection is legal (subject to ko/suicide rules).",
		{},
		async () => {
			if (!currentGame) {
				return { content: [{ type: "text" as const, text: "No active game." }] };
			}

			let moves: Record<string, string[]> = {};
			if (currentGame.type === "chess" && currentGame.chess) {
				moves = currentGame.chess.getLegalMovesObject();
			} else if (currentGame.type === "janggi" && currentGame.janggi) {
				moves = currentGame.janggi.getLegalMovesObject();
			} else if (currentGame.type === "go") {
				return {
					content: [
						{
							type: "text" as const,
							text: "Go: any empty intersection is legal (subject to ko rule and suicide prevention).",
						},
					],
				};
			}

			return { content: [{ type: "text" as const, text: JSON.stringify(moves, null, 2) }] };
		},
	);

	// --- get_opening ---
	server.tool(
		"get_opening",
		"Identify the chess opening from the current move sequence using ECO (Encyclopaedia of Chess Openings) codes.",
		{},
		async () => {
			if (!currentGame?.chess) {
				return {
					content: [{ type: "text" as const, text: "Chess game required for opening detection." }],
				};
			}
			const opening = detectOpening(currentGame.chess.getMoveHistory().map((m) => m.uci));
			return {
				content: [
					{
						type: "text" as const,
						text: opening ? `${opening.eco}: ${opening.name}` : "No recognized opening.",
					},
				],
			};
		},
	);

	// --- get_pgn ---
	server.tool(
		"get_pgn",
		"Export the current chess game in PGN (Portable Game Notation) format — the standard interchange format for chess games.",
		{},
		async () => {
			if (!currentGame?.chess) {
				return {
					content: [{ type: "text" as const, text: "Chess game required for PGN export." }],
				};
			}
			return { content: [{ type: "text" as const, text: currentGame.chess.pgn }] };
		},
	);

	const transport = new StdioServerTransport();
	await server.connect(transport);
	log.info("MCP server started on stdio");
}

function getPosition(): Record<string, unknown> {
	if (!currentGame) return { error: "No game" };

	if (currentGame.type === "chess" && currentGame.chess) {
		const g = currentGame.chess;
		const history = g.getMoveHistory();
		return {
			game: "chess",
			fen: g.fen,
			pgn: g.pgn,
			turn: g.turn,
			halfmove: g.moveCount,
			fullmove: Math.ceil(g.moveCount / 2),
			check: g.isCheck,
			gameOver: g.isGameOver,
			result: g.getGameResult(),
			opening: detectOpening(history.map((m) => m.uci)),
		};
	}

	if (currentGame.type === "go" && currentGame.go) {
		const g = currentGame.go;
		return {
			game: "go",
			boardSize: g.size,
			turn: g.turn,
			moveNumber: g.moveCount,
			gameOver: g.isGameOver,
			prisoners: g.prisoners,
			captures: { black: g.prisoners.black, white: g.prisoners.white },
			result: g.getGameResult(),
			kataGoMoves: g.getKataGoMoves(),
		};
	}

	if (currentGame.type === "janggi" && currentGame.janggi) {
		const g = currentGame.janggi;
		return {
			game: "janggi",
			fen: g.fen,
			turn: g.turn,
			moveNumber: g.moveCount,
			gameOver: g.isGameOver,
			checkmate: g.isCheckmate,
			result: g.getGameResult(),
			capturedPieces: g.getCapturedPieces(),
		};
	}

	return { error: "Unknown game" };
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
	startMcpServer().catch((err) => {
		console.error("MCP server failed:", err);
		process.exit(1);
	});
}

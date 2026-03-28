import type { DifficultyId, GameType } from "@tess/shared";

export type View = "home" | "game";

class AppState {
	view = $state<View>("home");
	gameType = $state<GameType>("chess");
	difficulty = $state<DifficultyId>(
		(localStorage.getItem("tess-difficulty") as DifficultyId) ?? "casual",
	);
	playerColor = $state<"white" | "black">("white");

	// Active game state
	gameId = $state<string | null>(null);
	fen = $state("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
	turn = $state<"white" | "black">("white");
	legalMoves = $state<Record<string, string[]>>({});
	moveHistory = $state<{ san: string; uci: string; fen: string; moveNumber: number }[]>([]);
	capturedPieces = $state<{ white: string[]; black: string[] }>({ white: [], black: [] });
	isCheck = $state(false);
	isGameOver = $state(false);
	result = $state<{ winner: "white" | "black" | "draw"; reason: string } | null>(null);

	setDifficulty(d: DifficultyId) {
		this.difficulty = d;
		localStorage.setItem("tess-difficulty", d);
	}

	updateFromGameState(data: {
		gameId: string;
		fen: string;
		turn: "white" | "black";
		legalMoves: Record<string, string[]>;
		moveHistory: { san: string; uci: string; fen: string; moveNumber: number }[];
		capturedPieces: { white: string[]; black: string[] };
		isCheck: boolean;
		isGameOver: boolean;
		result?: { winner: "white" | "black" | "draw"; reason: string };
	}) {
		this.gameId = data.gameId;
		this.fen = data.fen;
		this.turn = data.turn;
		this.legalMoves = data.legalMoves;
		this.moveHistory = data.moveHistory;
		this.capturedPieces = data.capturedPieces;
		this.isCheck = data.isCheck;
		this.isGameOver = data.isGameOver;
		this.result = data.result ?? null;
	}

	updateFromMove(data: {
		move: { san: string; uci: string; fen: string; moveNumber: number };
		turn: "white" | "black";
		legalMoves: Record<string, string[]>;
		capturedPieces: { white: string[]; black: string[] };
		isCheck: boolean;
		isGameOver: boolean;
		result?: { winner: "white" | "black" | "draw"; reason: string };
	}) {
		this.moveHistory = [...this.moveHistory, data.move];
		this.fen = data.move.fen;
		this.turn = data.turn;
		this.legalMoves = data.legalMoves;
		this.capturedPieces = data.capturedPieces;
		this.isCheck = data.isCheck;
		this.isGameOver = data.isGameOver;
		this.result = data.result ?? null;
	}

	reset() {
		this.gameId = null;
		this.fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
		this.turn = "white";
		this.legalMoves = {};
		this.moveHistory = [];
		this.capturedPieces = { white: [], black: [] };
		this.isCheck = false;
		this.isGameOver = false;
		this.result = null;
	}
}

export const appState = new AppState();

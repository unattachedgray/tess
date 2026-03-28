import type { DifficultyId, GameType, Suggestion } from "@tess/shared";

export type View = "home" | "game";

export type MoveQuality = "best" | "good" | "ok" | "inaccuracy" | "mistake" | "blunder" | null;

export interface AnalysisMessage {
	moveNumber: number;
	text: string;
	timestamp: number;
}

class AppState {
	view = $state<View>("home");
	gameType = $state<GameType>("chess");
	difficulty = $state<DifficultyId>(
		(localStorage.getItem("tess-difficulty") as DifficultyId) ?? "casual",
	);
	playerColor = $state<"white" | "black">("white");
	coachingEnabled = $state(localStorage.getItem("tess-coaching") !== "false");

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

	// Go-specific state
	boardState = $state<(string | null)[][]>([]);
	boardSize = $state(19);
	prisoners = $state<{ black: number; white: number }>({ black: 0, white: 0 });
	goLastMove = $state<{ x: number; y: number } | null>(null);

	// AI coaching state
	suggestions = $state<Suggestion[]>([]);
	suggestionsStale = $state(false);
	analysisMessages = $state<AnalysisMessage[]>([]);
	analysisLoading = $state(false);
	eval = $state<number>(0); // centipawns from white's perspective
	lastMoveQuality = $state<MoveQuality>(null);
	hintLevel = $state(0); // 0=none, 1=piece, 2=destination, 3=full arrow
	showArrows = $state(true);

	setDifficulty(d: DifficultyId) {
		this.difficulty = d;
		localStorage.setItem("tess-difficulty", d);
	}

	setCoaching(enabled: boolean) {
		this.coachingEnabled = enabled;
		localStorage.setItem("tess-coaching", String(enabled));
	}

	updateFromGameState(data: {
		gameId: string;
		gameType?: string;
		fen: string;
		turn: "white" | "black";
		legalMoves: Record<string, string[]>;
		moveHistory: { san: string; uci: string; fen: string; moveNumber: number }[];
		capturedPieces: { white: string[]; black: string[] };
		isCheck: boolean;
		isGameOver: boolean;
		result?: { winner: "white" | "black" | "draw"; reason: string };
		boardState?: (string | null)[][];
		boardSize?: number;
		prisoners?: { black: number; white: number };
	}) {
		this.gameId = data.gameId;
		if (data.gameType) this.gameType = data.gameType as GameType;
		this.fen = data.fen;
		this.turn = data.turn;
		this.legalMoves = data.legalMoves;
		this.moveHistory = data.moveHistory;
		this.capturedPieces = data.capturedPieces;
		this.isCheck = data.isCheck;
		this.isGameOver = data.isGameOver;
		this.result = data.result ?? null;
		if (data.boardState !== undefined) this.boardState = data.boardState;
		if (data.boardSize !== undefined) this.boardSize = data.boardSize;
		if (data.prisoners !== undefined) this.prisoners = data.prisoners;
	}

	updateFromMove(data: {
		move: { san: string; uci: string; fen: string; moveNumber: number };
		turn: "white" | "black";
		legalMoves: Record<string, string[]>;
		capturedPieces: { white: string[]; black: string[] };
		isCheck: boolean;
		isGameOver: boolean;
		result?: { winner: "white" | "black" | "draw"; reason: string };
		boardState?: (string | null)[][];
		prisoners?: { black: number; white: number };
		lastStone?: { x: number; y: number } | null;
	}) {
		this.moveHistory = [...this.moveHistory, data.move];
		this.fen = data.move.fen;
		this.turn = data.turn;
		this.legalMoves = data.legalMoves;
		this.capturedPieces = data.capturedPieces;
		this.isCheck = data.isCheck;
		this.isGameOver = data.isGameOver;
		this.result = data.result ?? null;
		if (data.boardState) this.boardState = data.boardState;
		if (data.prisoners) this.prisoners = data.prisoners;
		if (data.lastStone !== undefined) this.goLastMove = data.lastStone;
		this.suggestionsStale = true;
		this.hintLevel = 0;
		if (this.coachingEnabled) {
			this.analysisLoading = true;
		}
	}

	updateSuggestions(suggestions: Suggestion[]) {
		this.suggestions = suggestions;
		this.suggestionsStale = false;
		if (suggestions.length > 0) {
			this.eval = suggestions[0].score;
		}
	}

	updateMoveQuality(userMove: string, suggestions: Suggestion[]) {
		if (suggestions.length === 0) {
			this.lastMoveQuality = null;
			return;
		}

		const bestMove = suggestions[0].move;
		if (userMove === bestMove) {
			this.lastMoveQuality = "best";
			return;
		}

		const inTop = suggestions.some((s) => s.move === userMove);
		if (inTop) {
			this.lastMoveQuality = "good";
			return;
		}

		const bestScore = suggestions[0].score;
		const cpLoss = Math.abs(bestScore - this.eval);

		if (cpLoss < 30) this.lastMoveQuality = "ok";
		else if (cpLoss < 80) this.lastMoveQuality = "inaccuracy";
		else if (cpLoss < 200) this.lastMoveQuality = "mistake";
		else this.lastMoveQuality = "blunder";
	}

	addAnalysis(text: string) {
		const moveNum = this.moveHistory.length;
		this.analysisMessages = [
			...this.analysisMessages,
			{ moveNumber: moveNum, text, timestamp: Date.now() },
		];
		// Only clear loading if this is the latest move's analysis
		// (user might have already moved again)
		this.analysisLoading = false;
	}

	requestHint() {
		if (this.hintLevel < 3) this.hintLevel++;
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
		this.suggestions = [];
		this.suggestionsStale = false;
		this.analysisMessages = [];
		this.analysisLoading = false;
		this.eval = 0;
		this.lastMoveQuality = null;
		this.hintLevel = 0;
		this.boardState = [];
		this.boardSize = 19;
		this.prisoners = { black: 0, white: 0 };
		this.goLastMove = null;
	}
}

export const appState = new AppState();

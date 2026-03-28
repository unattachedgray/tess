import type { DifficultyId, GameType, Suggestion } from "@tess/shared";

export type View = "home" | "game";
export type MoveQuality = "best" | "good" | "ok" | "inaccuracy" | "mistake" | "blunder" | null;

export interface AnalysisMessage {
	moveNumber: number;
	text: string;
	timestamp: number;
}

// --- Persistent preferences (survive reload) ---

function loadPref<T>(key: string, fallback: T): T {
	try {
		const v = localStorage.getItem(`tess-${key}`);
		if (v === null) return fallback;
		return JSON.parse(v) as T;
	} catch {
		return fallback;
	}
}

function savePref(key: string, value: unknown): void {
	localStorage.setItem(`tess-${key}`, JSON.stringify(value));
}

// --- Bird name generator ---

const BIRDS = [
	"Albatross",
	"Bluebird",
	"Cardinal",
	"Dove",
	"Eagle",
	"Falcon",
	"Goldfinch",
	"Heron",
	"Ibis",
	"Jay",
	"Kingfisher",
	"Lark",
	"Magpie",
	"Nightingale",
	"Oriole",
	"Pelican",
	"Quail",
	"Robin",
	"Sparrow",
	"Toucan",
	"Umber",
	"Vireo",
	"Warbler",
	"Xenops",
	"Yellowhammer",
	"Zosterops",
	"Crane",
	"Darter",
	"Egret",
	"Finch",
	"Grouse",
	"Hawk",
	"Jackdaw",
	"Kestrel",
	"Linnet",
	"Martin",
	"Nuthatch",
	"Osprey",
	"Pipit",
	"Raven",
	"Starling",
	"Tanager",
	"Wren",
	"Swift",
	"Thrush",
	"Tern",
];

function generateUserId(): string {
	const bird = BIRDS[Math.floor(Math.random() * BIRDS.length)];
	const num = Math.floor(Math.random() * 9000) + 1000;
	return `${bird}${num}`;
}

function getBrowserKey(): string {
	const ua = navigator.userAgent;
	const lang = navigator.language;
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	// Simple hash
	let hash = 0;
	const str = `${ua}|${lang}|${tz}`;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
	}
	return Math.abs(hash).toString(36);
}

// --- App State ---

class AppState {
	// Persistent preferences
	gameType = $state<GameType>(loadPref("gameType", "chess"));
	difficulty = $state<DifficultyId>(loadPref("difficulty", "casual"));
	playerColor = $state<"white" | "black">(loadPref("playerColor", "white"));
	coachingEnabled = $state<boolean>(loadPref("coaching", true));
	suggestionCount = $state<number>(loadPref("suggestions", 3));
	boardSize = $state<number>(loadPref("boardSize", 19));

	// User identity (persistent)
	userId = $state<string>(
		loadPref("userId", "") ||
			(() => {
				const id = generateUserId();
				savePref("userId", id);
				return id;
			})(),
	);
	browserKey = $state<string>(getBrowserKey());

	// Active game state (not persisted)
	view = $state<View>("game");
	gameId = $state<string | null>(null);
	fen = $state("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
	turn = $state<"white" | "black">("white");
	legalMoves = $state<Record<string, string[]>>({});
	moveHistory = $state<{ san: string; uci: string; fen: string; moveNumber: number }[]>([]);
	capturedPieces = $state<{ white: string[]; black: string[] }>({ white: [], black: [] });
	isCheck = $state(false);
	isGameOver = $state(false);
	result = $state<{ winner: "white" | "black" | "draw"; reason: string } | null>(null);

	// Go-specific
	boardState = $state<(string | null)[][]>([]);
	prisoners = $state<{ black: number; white: number }>({ black: 0, white: 0 });
	goLastMove = $state<{ x: number; y: number } | null>(null);

	// AI coaching
	suggestions = $state<Suggestion[]>([]);
	suggestionsStale = $state(false);
	analysisMessages = $state<AnalysisMessage[]>([]);
	analysisLoading = $state(false);
	eval = $state<number>(0);
	lastMoveQuality = $state<MoveQuality>(null);
	hintLevel = $state(0);
	showArrows = $state(true);
	skillEval = $state<{
		accuracy: number;
		acpl: number;
		skill: { label: string; rating: string; description: string };
	} | null>(null);
	gameSummary = $state<string | null>(null);

	// Player counts (from server)
	playerCounts = $state<{ chess: number; go: number; janggi: number; total: number }>({
		chess: 0,
		go: 0,
		janggi: 0,
		total: 0,
	});

	// --- Setters (persist on change) ---

	setGameType(t: GameType) {
		this.gameType = t;
		savePref("gameType", t);
	}

	setDifficulty(d: DifficultyId) {
		this.difficulty = d;
		savePref("difficulty", d);
	}

	setPlayerColor(c: "white" | "black") {
		this.playerColor = c;
		savePref("playerColor", c);
	}

	setCoaching(enabled: boolean) {
		this.coachingEnabled = enabled;
		savePref("coaching", enabled);
	}

	setSuggestionCount(n: number) {
		this.suggestionCount = n;
		savePref("suggestions", n);
	}

	setBoardSize(s: number) {
		this.boardSize = s;
		savePref("boardSize", s);
	}

	// --- State updates ---

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
		if (this.coachingEnabled) this.analysisLoading = true;
	}

	updateSuggestions(suggestions: Suggestion[]) {
		this.suggestions = suggestions;
		this.suggestionsStale = false;
		if (suggestions.length > 0) this.eval = suggestions[0].score;
	}

	addAnalysis(text: string, moveNumber?: number) {
		const moveNum = moveNumber ?? this.moveHistory.length;
		this.analysisMessages = [
			...this.analysisMessages,
			{ moveNumber: moveNum, text, timestamp: Date.now() },
		];
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
		this.skillEval = null;
		this.gameSummary = null;
		this.boardState = [];
		this.prisoners = { black: 0, white: 0 };
		this.goLastMove = null;
	}
}

export const appState = new AppState();

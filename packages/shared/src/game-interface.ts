/**
 * IGame — Universal game interface for all board games in Tess.
 *
 * Any game plugin (chess, go, janggi, xiangqi, shogi, etc.) must implement
 * this interface. The framework interacts with games ONLY through this API.
 *
 * Design influenced by:
 * - XBoard/WinBoard protocol (variant-agnostic move/result interface)
 * - Lichess Board API (standardized game state representation)
 * - UCI protocol (position + moves abstraction)
 */

/** Result of executing a move. */
export interface MoveResult {
	/** Move in the game's notation (UCI, GTP coordinate, etc.) */
	notation: string;
	/** Human-readable notation (SAN for chess, coordinate for Go, etc.) */
	display: string;
	/** Position string after the move (FEN, board hash, etc.) */
	position: string;
	/** Move number (1-indexed, counts full moves not half-moves) */
	moveNumber: number;
}

/** Final result of a completed game. */
export interface PluginGameResult {
	winner: "white" | "black" | "draw";
	reason: string; // "checkmate", "resignation", "timeout", "agreement", etc.
}

/** Serializable game state snapshot — sent to clients. */
export interface GameSnapshot {
	/** Position string (FEN for chess-family, empty for grid-based) */
	fen: string;
	/** Grid state for non-FEN games (Go, etc.) */
	boardState?: (string | null)[][];
	/** Board dimensions (for grid-based games) */
	boardSize?: number;
	/** Whose turn it is */
	turn: "white" | "black";
	/** Legal moves keyed by source square/position */
	legalMoves: Record<string, string[]>;
	/** Full move history */
	moveHistory: MoveResult[];
	/** Captured pieces per side */
	captured: { white: string[]; black: string[] };
	/** Game-specific extra state (prisoners, check status, etc.) */
	extra: Record<string, unknown>;
}

/**
 * IGame — the contract every game plugin must fulfill.
 *
 * Games are stateful: create an instance, call move() repeatedly,
 * query state via getters. The framework never reaches into game internals.
 */
export interface IGame {
	/** Variant identifier (e.g., "chess", "go-19", "janggi", "xiangqi") */
	readonly variant: string;

	/** Current turn */
	readonly turn: "white" | "black";

	/** Number of moves played */
	readonly moveCount: number;

	/** Whether the game has ended */
	readonly isGameOver: boolean;

	/**
	 * Execute a move. The notation format depends on the game:
	 * - Chess-family: UCI notation (e.g., "e2e4", "e7e8q")
	 * - Go: GTP coordinate (e.g., "D4") or "PASS"
	 * - Other: game-defined string
	 *
	 * Returns null if the move is illegal.
	 */
	move(notation: string): MoveResult | null;

	/** Get all legal moves from the current position. */
	getLegalMoves(): Record<string, string[]>;

	/** Get the game result (only meaningful when isGameOver is true). */
	getResult(): PluginGameResult | null;

	/** Get a serializable snapshot of the full game state. */
	getSnapshot(): GameSnapshot;

	/** Reset to starting position. */
	reset(): void;
}

/**
 * GameDefinition — metadata for registering a game plugin.
 *
 * The registry uses this to know what engine to use, how to display the game,
 * and how to create instances.
 */
export interface GameDefinition {
	/** Unique variant identifier */
	variant: string;

	/** Human-readable display name */
	displayName: string;

	/** Game family — determines which board renderer to use */
	family: "chess" | "go" | "custom";

	/** Factory function to create a new game instance */
	create: (options?: Record<string, unknown>) => IGame;

	/** Engine configuration */
	engine: {
		/** Engine type: "fairy-stockfish", "katago", or custom */
		type: string;
		/** UCI_Variant option value (for Fairy-Stockfish variants) */
		uciVariant?: string;
		/** Default difficulty settings */
		defaultDifficulty?: Record<string, unknown>;
	};

	/** Board configuration */
	board: {
		/** Board dimensions: [cols, rows] for rectangular, [size] for square */
		dimensions: [number, number] | [number];
		/** Piece set identifier (for rendering) */
		pieceSet?: string;
		/** Whether the board uses coordinates (a1-h8 style) */
		coordinates?: boolean;
	};

	/** Supported export formats */
	exportFormats?: string[]; // ["pgn", "fen"] for chess, ["sgf"] for go
}

/**
 * GameRegistry — singleton that holds all registered game plugins.
 *
 * Games register themselves at import time. The framework queries the
 * registry to discover available games, create instances, and route
 * to the correct engine.
 */
export class GameRegistry {
	private static games = new Map<string, GameDefinition>();

	static register(def: GameDefinition): void {
		if (GameRegistry.games.has(def.variant)) {
			console.warn(`Game variant "${def.variant}" already registered, overwriting`);
		}
		GameRegistry.games.set(def.variant, def);
	}

	static get(variant: string): GameDefinition | undefined {
		return GameRegistry.games.get(variant);
	}

	static getAll(): GameDefinition[] {
		return Array.from(GameRegistry.games.values());
	}

	static getByFamily(family: string): GameDefinition[] {
		return GameRegistry.getAll().filter((g) => g.family === family);
	}

	static getVariants(): string[] {
		return Array.from(GameRegistry.games.keys());
	}

	static has(variant: string): boolean {
		return GameRegistry.games.has(variant);
	}
}

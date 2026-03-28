export type GameType = "go" | "chess" | "janggi";

export type PlayerColor = "white" | "black";

export type DifficultyId = "beginner" | "casual" | "club" | "pro" | "superhuman";

export interface DifficultyTier {
	id: DifficultyId;
	label: string;
	chessMovetime: number;
	chessLabel: string;
	goVisits: number;
	goLabel: string;
	janggiMovetime: number;
	janggiLabel: string;
}

export interface TimeControl {
	initial: number; // seconds
	increment: number; // seconds
}

export interface GameConfig {
	gameType: GameType;
	difficulty: DifficultyId;
	playerColor: PlayerColor;
	boardSize?: number; // Go only
	timeControl?: TimeControl;
}

export interface GameResult {
	winner: PlayerColor | "draw";
	reason: string;
}

export interface MoveInfo {
	san: string;
	uci: string;
	fen: string;
	moveNumber: number;
}

export interface Suggestion {
	move: string;
	san?: string;
	score: number;
	depth: number;
	pv: string[];
}

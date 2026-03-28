import { z } from "zod";

// Client → Server messages

export const NewGameMessage = z.object({
	type: z.literal("NEW_GAME"),
	gameType: z.enum(["go", "chess", "janggi"]),
	difficulty: z.enum(["beginner", "casual", "club", "pro", "superhuman"]),
	playerColor: z.enum(["white", "black"]).default("white"),
	boardSize: z.number().optional(),
	coaching: z.boolean().optional(),
	suggestionCount: z.number().optional(),
	suggestionStrength: z.enum(["fast", "balanced", "deep"]).optional(),
	language: z.string().optional(),
});

export const JoinGameMessage = z.object({
	type: z.literal("JOIN_GAME"),
	gameId: z.string(),
});

export const PlayMoveMessage = z.object({
	type: z.literal("PLAY_MOVE"),
	move: z.string(),
});

export const ResignMessage = z.object({
	type: z.literal("RESIGN"),
});

export const PassMessage = z.object({
	type: z.literal("PASS"),
});

export const RequestAnalysisMessage = z.object({
	type: z.literal("REQUEST_ANALYSIS"),
});

export const SetCoachingMessage = z.object({
	type: z.literal("SET_COACHING"),
	enabled: z.boolean(),
});

export const SetSuggestionsMessage = z.object({
	type: z.literal("SET_SUGGESTIONS"),
	count: z.number(),
});

export const AutoplayMessage = z.object({
	type: z.literal("AUTOPLAY"),
	enabled: z.boolean(),
	humanElo: z.number().optional(),
});

export const RequestHintMessage = z.object({
	type: z.literal("REQUEST_HINT"),
});

export const ClientMessage = z.discriminatedUnion("type", [
	NewGameMessage,
	JoinGameMessage,
	PlayMoveMessage,
	ResignMessage,
	PassMessage,
	RequestAnalysisMessage,
	SetCoachingMessage,
	SetSuggestionsMessage,
	AutoplayMessage,
	RequestHintMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;

// Server → Client messages

export const GameStatePayload = z.object({
	type: z.literal("GAME_STATE"),
	gameId: z.string(),
	gameType: z.enum(["go", "chess", "janggi"]).optional(),
	fen: z.string(),
	boardState: z.array(z.array(z.string().nullable())).optional(),
	boardSize: z.number().optional(),
	prisoners: z.object({ black: z.number(), white: z.number() }).optional(),
	playerColor: z.enum(["white", "black"]),
	turn: z.enum(["white", "black"]),
	legalMoves: z.record(z.string(), z.array(z.string())),
	moveHistory: z.array(
		z.object({
			san: z.string(),
			uci: z.string(),
			fen: z.string(),
			moveNumber: z.number(),
		}),
	),
	capturedPieces: z.object({
		white: z.array(z.string()),
		black: z.array(z.string()),
	}),
	isCheck: z.boolean(),
	isGameOver: z.boolean(),
	result: z
		.object({
			winner: z.enum(["white", "black", "draw"]),
			reason: z.string(),
		})
		.optional(),
	difficulty: z.string(),
});

export const MovePayload = z.object({
	type: z.literal("MOVE"),
	move: z.object({
		san: z.string(),
		uci: z.string(),
		fen: z.string(),
		moveNumber: z.number(),
	}),
	turn: z.enum(["white", "black"]),
	legalMoves: z.record(z.string(), z.array(z.string())),
	capturedPieces: z.object({
		white: z.array(z.string()),
		black: z.array(z.string()),
	}),
	isCheck: z.boolean(),
	isGameOver: z.boolean(),
	result: z
		.object({
			winner: z.enum(["white", "black", "draw"]),
			reason: z.string(),
		})
		.optional(),
});

export const SuggestionsPayload = z.object({
	type: z.literal("SUGGESTIONS"),
	suggestions: z.array(
		z.object({
			move: z.string(),
			san: z.string().optional(),
			score: z.number(),
			depth: z.number(),
			pv: z.array(z.string()),
		}),
	),
});

export const AnalysisPayload = z.object({
	type: z.literal("ANALYSIS"),
	text: z.string(),
});

export const GameOverPayload = z.object({
	type: z.literal("GAME_OVER"),
	result: z.object({
		winner: z.enum(["white", "black", "draw"]),
		reason: z.string(),
	}),
});

export const ErrorPayload = z.object({
	type: z.literal("ERROR"),
	message: z.string(),
});

export const MoveQualityPayload = z.object({
	type: z.literal("MOVE_QUALITY"),
	move: z.string(),
	quality: z.enum(["best", "good", "ok", "inaccuracy", "mistake", "blunder"]),
});

export const HintPayload = z.object({
	type: z.literal("HINT"),
	level: z.number(),
	piece: z.string().optional(),
	destination: z.string().optional(),
	fullMove: z.string().optional(),
});

export const SkillEvalPayload = z.object({
	type: z.literal("SKILL_EVAL"),
	accuracy: z.number(),
	acpl: z.number(),
	skill: z.object({
		label: z.string(),
		rating: z.string(),
		description: z.string(),
	}),
});

export const DifficultyTiersPayload = z.object({
	type: z.literal("DIFFICULTY_TIERS"),
	tiers: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
			chessMovetime: z.number(),
			chessLabel: z.string(),
		}),
	),
});

export type ServerMessage =
	| z.infer<typeof GameStatePayload>
	| z.infer<typeof MovePayload>
	| z.infer<typeof SuggestionsPayload>
	| z.infer<typeof AnalysisPayload>
	| z.infer<typeof GameOverPayload>
	| z.infer<typeof ErrorPayload>
	| z.infer<typeof DifficultyTiersPayload>
	| z.infer<typeof MoveQualityPayload>
	| z.infer<typeof HintPayload>
	| z.infer<typeof SkillEvalPayload>;

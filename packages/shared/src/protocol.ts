import { z } from "zod";
import type { TimeControl } from "./types.js";

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


// ── Multiplayer: Client → Server ──

export const SetNicknameMessage = z.object({
	type: z.literal("SET_NICKNAME"),
	nickname: z.string().min(2).max(20),
});

export const TimeControlSchema = z.object({
	initial: z.number().min(0),  // seconds
	increment: z.number().min(0),
});

export const CreateChallengeMessage = z.object({
	type: z.literal("CREATE_CHALLENGE"),
	gameType: z.enum(["go", "chess", "janggi"]),
	timeControl: TimeControlSchema,
	color: z.enum(["white", "black"]).optional(),
	boardSize: z.number().optional(),
});

export const CancelChallengeMessage = z.object({
	type: z.literal("CANCEL_CHALLENGE"),
	challengeId: z.string(),
});

export const AcceptChallengeMessage = z.object({
	type: z.literal("ACCEPT_CHALLENGE"),
	challengeId: z.string(),
});

export const JoinByCodeMessage = z.object({
	type: z.literal("JOIN_BY_CODE"),
	code: z.string().length(6),
	spectate: z.boolean().optional(),
});

export const RequestLobbyMessage = z.object({
	type: z.literal("REQUEST_LOBBY"),
});

export const LeaveLobbyMessage = z.object({
	type: z.literal("LEAVE_LOBBY"),
});

export const EmojiReactionMessage = z.object({
	type: z.literal("EMOJI_REACTION"),
	emoji: z.string(),
});

export const OfferDrawMessage = z.object({
	type: z.literal("OFFER_DRAW"),
});

export const RespondDrawMessage = z.object({
	type: z.literal("RESPOND_DRAW"),
	accept: z.boolean(),
});

export const PRESET_EMOJIS = ["\u{1F44D}", "\u{1F44F}", "\u{1F605}", "\u{1F914}", "\u{26A1}", "\u{1F91D}"] as const;

export const TIME_PRESETS = [
	{ label: "Bullet 1+0", initial: 60, increment: 0 },
	{ label: "Blitz 3+2", initial: 180, increment: 2 },
	{ label: "Rapid 10+5", initial: 600, increment: 5 },
	{ label: "Classical 30+0", initial: 1800, increment: 0 },
	{ label: "No limit", initial: 0, increment: 0 },
] as const;

export type Challenge = {
	id: string;
	code: string;
	gameType: "go" | "chess" | "janggi";
	timeControl: TimeControl;
	creatorName: string;
	creatorColor?: "white" | "black";
	boardSize?: number;
	createdAt: number;
};


// ── Multiplayer: Client → Server ──

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
	// Multiplayer
	SetNicknameMessage,
	CreateChallengeMessage,
	CancelChallengeMessage,
	AcceptChallengeMessage,
	JoinByCodeMessage,
	RequestLobbyMessage,
	LeaveLobbyMessage,
	EmojiReactionMessage,
	OfferDrawMessage,
	RespondDrawMessage,
]);

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


// ── Multiplayer: Server → Client ──

export const NicknameSetPayload = z.object({
	type: z.literal("NICKNAME_SET"),
	nickname: z.string(),
});

export const LobbyStatePayload = z.object({
	type: z.literal("LOBBY_STATE"),
	challenges: z.array(z.object({
		id: z.string(),
		code: z.string(),
		gameType: z.enum(["go", "chess", "janggi"]),
		timeControl: TimeControlSchema,
		creatorName: z.string(),
		creatorColor: z.enum(["white", "black"]).optional(),
		boardSize: z.number().optional(),
		createdAt: z.number(),
	})),
	activePlayers: z.number(),
});

export const ChallengeCreatedPayload = z.object({
	type: z.literal("CHALLENGE_CREATED"),
	challengeId: z.string(),
	code: z.string(),
});

export const MpGameStartPayload = z.object({
	type: z.literal("MP_GAME_START"),
	gameId: z.string(),
	gameType: z.enum(["go", "chess", "janggi"]),
	yourColor: z.enum(["white", "black"]),
	opponentName: z.string(),
	timeControl: TimeControlSchema,
});

export const ClockUpdatePayload = z.object({
	type: z.literal("CLOCK_UPDATE"),
	white: z.number(),
	black: z.number(),
	running: z.enum(["white", "black"]).nullable(),
});

export const EmojiReactionPayload = z.object({
	type: z.literal("EMOJI_RECEIVED"),
	emoji: z.string(),
	from: z.string(),
});

export const DrawOfferPayload = z.object({
	type: z.literal("DRAW_OFFER"),
});

export const DrawResponsePayload = z.object({
	type: z.literal("DRAW_RESPONSE"),
	accepted: z.boolean(),
});

export const OpponentDisconnectedPayload = z.object({
	type: z.literal("OPPONENT_DISCONNECTED"),
	gracePeriod: z.number(),
});

export const OpponentReconnectedPayload = z.object({
	type: z.literal("OPPONENT_RECONNECTED"),
});

export const SpectatorCountPayload = z.object({
	type: z.literal("SPECTATOR_COUNT"),
	count: z.number(),
});

export const PlayerCountPayload = z.object({
	type: z.literal("PLAYER_COUNT"),
	chess: z.number(),
	go: z.number(),
	janggi: z.number(),
	total: z.number(),
});

export const GameSummaryPayload = z.object({
	type: z.literal("GAME_SUMMARY"),
	text: z.string(),
});


// ── Multiplayer: Server → Client ──

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
	| z.infer<typeof SkillEvalPayload>
	// Multiplayer
	| z.infer<typeof NicknameSetPayload>
	| z.infer<typeof LobbyStatePayload>
	| z.infer<typeof ChallengeCreatedPayload>
	| z.infer<typeof MpGameStartPayload>
	| z.infer<typeof ClockUpdatePayload>
	| z.infer<typeof EmojiReactionPayload>
	| z.infer<typeof DrawOfferPayload>
	| z.infer<typeof DrawResponsePayload>
	| z.infer<typeof OpponentDisconnectedPayload>
	| z.infer<typeof OpponentReconnectedPayload>
	| z.infer<typeof SpectatorCountPayload>
	| z.infer<typeof PlayerCountPayload>
	| z.infer<typeof GameSummaryPayload>;

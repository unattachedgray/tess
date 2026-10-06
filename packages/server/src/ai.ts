import { callGateway } from "./gateway.js";
import type { GameType, Suggestion } from "@tess/shared";
import { allowAiCall } from "./guard.js";
import { createLogger } from "./logger.js";

const log = createLogger("ai");

const PHASE_THRESHOLDS: Record<GameType, [number, number]> = {
	chess: [10, 30],
	go: [40, 150],
	janggi: [10, 40],
};

const PHASE_NAMES: Record<GameType, [string, string, string]> = {
	chess: ["Opening", "Middlegame", "Endgame"],
	go: ["Opening (fuseki)", "Middle game (chuban)", "Endgame (yose)"],
	janggi: ["Opening", "Middlegame", "Endgame"],
};

function getPhase(gameType: GameType, moveCount: number): string {
	const [mid, end] = PHASE_THRESHOLDS[gameType];
	const names = PHASE_NAMES[gameType];
	if (moveCount <= mid) return names[0];
	if (moveCount <= end) return names[1];
	return names[2];
}

function fmtSuggestions(suggestions: Suggestion[], gameType: GameType): string {
	if (suggestions.length === 0) return "None available";
	return suggestions
		.slice(0, 3)
		.map((s, i) => {
			const line =
				s.pv && s.pv.length > 1 ? `; line: ${s.pv.slice(0, 4).join(" ")}` : "";
			if (gameType === "go") {
				const pts = (s.score / 100).toFixed(1);
				return `${i + 1}. ${s.san ?? s.move} (${Number(pts) >= 0 ? "+" : ""}${pts} points${line})`;
			}
			const sc = Math.abs(s.score) > 9000 ? "Mate" : `${(s.score / 100).toFixed(1)}`;
			return `${i + 1}. ${s.san ?? s.move} (${sc}${line})`;
		})
		.join(", ");
}

/** Describe what the player's own last move cost, so the coach can be concrete. */
function fmtPlayerMove(
	pm: { move: string; quality: string; cpLoss: number } | undefined,
	gameType: GameType,
): string {
	if (!pm) return "";
	const cost =
		gameType === "go"
			? `${(pm.cpLoss / 100).toFixed(1)} points`
			: `${(pm.cpLoss / 100).toFixed(1)} pawns`;
	if (pm.quality === "best" || pm.quality === "good") {
		return ` The human's last move ${pm.move} was ${pm.quality === "best" ? "the engine's top choice" : "strong"}.`;
	}
	return ` The human's last move ${pm.move} was a ${pm.quality}, costing about ${cost} versus the best move.`;
}

function buildPrompt(ctx: AnalysisContext): string {
	const phase = getPhase(ctx.gameType, ctx.moveCount);
	const game = ctx.gameType === "go" ? "Go" : ctx.gameType === "janggi" ? "Janggi" : "Chess";
	const player = ctx.playerColor === "white" ? "White" : "Black";

	const lastMoveStr = ctx.lastMove
		? `Last move (${ctx.lastMoveColor}): ${ctx.lastMove}.`
		: "Opening position.";

	const sugs = fmtSuggestions(ctx.suggestions, ctx.gameType);

	// Full game record — even a short move list grounds the model far better
	// than the last move alone. Pairs of alternating moves, numbered.
	let record = "";
	if (ctx.history && ctx.history.length > 0) {
		const pairs: string[] = [];
		for (let i = 0; i < ctx.history.length; i += 2) {
			const white = ctx.history[i];
			const black = ctx.history[i + 1];
			pairs.push(`${i / 2 + 1}. ${white}${black ? ` ${black}` : ""}`);
		}
		const firstColor = ctx.gameType === "go" ? "Black" : "White";
		record = ` Moves so far (${firstColor} moves first in each pair): ${pairs.join(" ")}.`;
	} else if (ctx.gameType === "go" && ctx.pgn) {
		record = ` Moves so far: ${ctx.pgn}.`;
	}

	// Current position for board games with a FEN representation
	const posContext =
		(ctx.gameType === "chess" || ctx.gameType === "janggi") && ctx.fen
			? ` Current FEN: ${ctx.fen}.`
			: "";

	// Language instruction
	const langMap: Record<string, string> = {
		ko: " Respond in Korean.",
		es: " Respond in Spanish.",
		vi: " Respond in Vietnamese.",
		mn: " Respond in Mongolian.",
	};
	const langInstr = ctx.language ? (langMap[ctx.language] ?? "") : "";

	const opponentSection = ctx.lastMove
		? `**Opponent:** what ${ctx.lastMoveColor}'s ${ctx.lastMove} intends — the threat or plan behind it (1-2 sentences).
`
		: "";

	const playerMoveStr = fmtPlayerMove(ctx.playerLastMove, ctx.gameType);

	return `You are a ${game} coaching engine. You ALWAYS provide analysis — never refuse or say you can't analyze. The engine has already computed the best moves; your job is to explain the game in plain language. Ground every claim in the move record given below — do not invent moves that are not in it. When the human's move lost ground, say concretely what it missed or allowed.

Move ${ctx.moveCount} (${phase}). Human plays ${player}.${record}${posContext} ${lastMoveStr}${playerMoveStr} Engine's best moves for ${player}: ${sugs}.

Answer in exactly these sections, each on its own line, using these bold labels:
${opponentSection}**Best move:** why the engine's top suggestion works and what it achieves tactically or positionally (1-2 sentences).
**Position:** how the game has gone so far and who stands better — key imbalances and the plan for ${player} (1-2 sentences).

Use **bold** for key terms. Under 120 words total. Never mention limitations or suggest other tools.${langInstr}`;
}

export interface AnalysisContext {
	gameType: GameType;
	fen: string;
	moveCount: number;
	playerColor: "white" | "black";
	lastMove?: string;
	lastMoveColor?: string;
	suggestions: Suggestion[];
	/** Every move played so far, in display notation, oldest first */
	history?: string[];
	pgn?: string;
	language?: string;
	/** Quality of the player's own last move (from engine grading) */
	playerLastMove?: { move: string; quality: string; cpLoss: number };
}

const TIMEOUT_MS = 30000;
const MAX_CONCURRENT = 2;
let activeCalls = 0;
const analysisQueue: { prompt: string; resolve: (v: string | null) => void }[] = [];

function processQueue(): void {
	while (analysisQueue.length > 0 && activeCalls < MAX_CONCURRENT) {
		const item = analysisQueue.shift()!;
		activeCalls++;
		callGateway(item.prompt, TIMEOUT_MS, "position-coaching")
			.then((result) => item.resolve(result))
			.catch((err) => {
				log.error("queued analysis failed", { error: (err as Error).message });
				item.resolve(null);
			})
			.finally(() => {
				activeCalls--;
				processQueue();
			});
	}
}

export async function analyzePosition(ctx: AnalysisContext): Promise<string | null> {
	// Spend cap. MAX_CONCURRENT below bounds parallelism, not volume — on a
	// public server those are different problems, and only this one bounds the
	// bill. Returning null degrades to a game without coaching, never an error.
	if (!allowAiCall()) return null;
	const prompt = buildPrompt(ctx);

	if (activeCalls < MAX_CONCURRENT) {
		activeCalls++;
		try {
			const result = await callGateway(prompt, TIMEOUT_MS, "position-coaching");
			return result;
		} catch (err) {
			log.error("analysis failed", { error: (err as Error).message });
			return null;
		} finally {
			activeCalls--;
			processQueue();
		}
	}

	// Queue if busy — only keep the latest request (most relevant position)
	if (analysisQueue.length >= 1) {
		const dropped = analysisQueue.shift()!;
		dropped.resolve(null);
	}

	return new Promise<string | null>((resolve) => {
		analysisQueue.push({ prompt, resolve });
	});
}

export interface GameSummaryContext {
	gameType: "chess" | "go" | "janggi";
	playerColor: "white" | "black";
	accuracy: number;
	acpl: number;
	skillLabel: string;
	skillRating: string;
	totalMoves: number;
	result: string;
	pgn?: string;
	moveAccuracies?: number[];
	language?: string;
}

export async function generateGameSummary(ctx: GameSummaryContext): Promise<string | null> {
	if (!allowAiCall()) return null;
	const game = ctx.gameType === "go" ? "Go" : ctx.gameType === "janggi" ? "Janggi" : "Chess";
	const player = ctx.playerColor === "white" ? "White" : "Black";

	// Find worst moves (lowest accuracy indices)
	let worstMoves = "";
	if (ctx.moveAccuracies && ctx.moveAccuracies.length > 0) {
		const indexed = ctx.moveAccuracies.map((acc, i) => ({ acc, moveNum: i + 1 }));
		const worst = indexed.sort((a, b) => a.acc - b.acc).slice(0, 3);
		worstMoves = ` Weakest moments at moves ${worst.map((w) => `${w.moveNum} (${Math.round(w.acc)}%)`).join(", ")}.`;
	}

	const prompt = `${game} game review. Player=${player}. Result: ${ctx.result}. ${ctx.totalMoves} moves. Accuracy: ${ctx.accuracy}%, ACPL: ${ctx.acpl}. Skill: ${ctx.skillLabel} (~${ctx.skillRating}).${worstMoves}${ctx.pgn ? ` PGN: ${ctx.pgn}` : ""}

Write a 3-4 sentence game summary for the player. Comment on their strengths, key mistakes, and one specific improvement tip. Be encouraging but honest. Use **bold** for key concepts. Under 80 words.${ctx.language && ctx.language !== "en" ? ` Respond in ${({ ko: "Korean", es: "Spanish", vi: "Vietnamese", mn: "Mongolian" })[ctx.language] ?? "English"}.` : ""}`;

	try {
		const result = await callGateway(prompt, 45000, "game-summary");
		return result;
	} catch (err) {
		log.error("game summary failed", { error: (err as Error).message });
		return null;
	}
}

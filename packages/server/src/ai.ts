import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GameType, Suggestion } from "@tess/shared";
import { createLogger } from "./logger.js";

const log = createLogger("ai");

// Gemini API keys: process.env first, then ~/.env (where local secrets live).
// Order matters — free-tier key first, paid key as 429 fallback.
const GEMINI_KEYS: string[] = (() => {
	let envFile = "";
	try {
		envFile = readFileSync(join(homedir(), ".env"), "utf8");
	} catch {}
	const fromFile = (name: string): string | null => {
		const m = envFile.match(new RegExp(`^${name}=(.+)$`, "m"));
		return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
	};
	const keys = [
		process.env.GEMINI_API_KEY ?? fromFile("GEMINI_API_KEY"),
		process.env.GEMINI_PAID_API_KEY ?? fromFile("GEMINI_PAID_API_KEY"),
	].filter((k): k is string => !!k);
	const deduped = [...new Set(keys)];
	if (deduped.length === 0)
		log.warn("GEMINI_API_KEY not found in env or ~/.env — AI coaching disabled");
	return deduped;
})();

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
// Post-game summaries are worth a stronger model (one call per game)
const GEMINI_SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL ?? "gemini-pro-latest";
// Cap thinking on per-move coaching: cards are <120 words and latency matters.
// Summaries keep the model's default budget (one call per game, quality wins).
const ANALYSIS_THINKING_BUDGET = 256;

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
		callGemini(item.prompt, TIMEOUT_MS, GEMINI_MODEL, ANALYSIS_THINKING_BUDGET)
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
	const prompt = buildPrompt(ctx);

	if (activeCalls < MAX_CONCURRENT) {
		activeCalls++;
		try {
			const result = await callGemini(prompt, TIMEOUT_MS, GEMINI_MODEL, ANALYSIS_THINKING_BUDGET);
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
		const result = await callGemini(prompt, 45000, GEMINI_SUMMARY_MODEL);
		return result;
	} catch (err) {
		log.error("game summary failed", { error: (err as Error).message });
		return null;
	}
}

async function callGemini(
	prompt: string,
	timeoutMs: number,
	model = GEMINI_MODEL,
	thinkingBudget?: number,
): Promise<string> {
	if (GEMINI_KEYS.length === 0) throw new Error("GEMINI_API_KEY not configured");
	// 429 (rate limit) and 503/500 (overload) are transient: rotate through the
	// keys, then back off and rotate again before giving up. Overload spikes on
	// the flash model regularly last 10-30s — a single-shot call loses every
	// coaching card in that window.
	const waves = [0, 2500, 6000];
	let lastErr: Error = new Error("unreachable");
	for (const wait of waves) {
		if (wait) await new Promise((r) => setTimeout(r, wait));
		for (const key of GEMINI_KEYS) {
			try {
				return await geminiRequest(prompt, timeoutMs, key, model, thinkingBudget);
			} catch (err) {
				lastErr = err as Error;
				if (!/HTTP (429|500|503)/.test(lastErr.message)) throw lastErr;
			}
		}
	}
	throw lastErr;
}

async function geminiRequest(
	prompt: string,
	timeoutMs: number,
	key: string,
	model: string,
	thinkingBudget?: number,
): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-goog-api-key": key,
				},
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						temperature: 0.6,
						// Thinking tokens count against maxOutputTokens on 2.5 models —
						// an uncapped thinking phase can eat the whole budget and return
						// an empty response. Coaching cards are short; cap thinking.
						maxOutputTokens: 4096,
						...(thinkingBudget !== undefined
							? { thinkingConfig: { thinkingBudget } }
							: {}),
					},
				}),
				signal: controller.signal,
			},
		);
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 200)}`);
		}
		const data = (await res.json()) as {
			candidates?: { content?: { parts?: { text?: string }[] } }[];
		};
		const text = data.candidates?.[0]?.content?.parts
			?.map((p) => p.text ?? "")
			.join("")
			.trim();
		if (!text) throw new Error("Gemini returned empty response");
		return text;
	} finally {
		clearTimeout(timer);
	}
}

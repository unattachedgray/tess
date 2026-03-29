import { execFile } from "node:child_process";
import { mkdirSync, accessSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameType, Suggestion } from "@tess/shared";
import { createLogger } from "./logger.js";

const log = createLogger("ai");

import { homedir } from "node:os";

// Resolve claude CLI path — may be in ~/.local/bin which isn't always in PATH
const CLAUDE_BIN = (() => {
	const localBin = join(homedir(), ".local", "bin", "claude");
	try {
		accessSync(localBin);
		return localBin;
	} catch {
		return "claude"; // Fall back to PATH
	}
})();

const SANDBOX_DIR = join(tmpdir(), "tess-claude-sandbox");
try {
	mkdirSync(SANDBOX_DIR, { recursive: true });
} catch {}

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
			if (gameType === "go") {
				const wr = ((s.score + 5000) / 100).toFixed(0);
				return `${i + 1}. ${s.san ?? s.move} (${wr}%)`;
			}
			const sc = Math.abs(s.score) > 9000 ? "Mate" : `${(s.score / 100).toFixed(1)}`;
			return `${i + 1}. ${s.san ?? s.move} (${sc})`;
		})
		.join(", ");
}

function buildPrompt(ctx: AnalysisContext): string {
	const phase = getPhase(ctx.gameType, ctx.moveCount);
	const game = ctx.gameType === "go" ? "Go" : ctx.gameType === "janggi" ? "Janggi" : "Chess";
	const player = ctx.playerColor === "white" ? "White" : "Black";

	const lastMoveStr = ctx.lastMove
		? `Last move (${ctx.lastMoveColor}): ${ctx.lastMove}.`
		: "Opening position.";

	const sugs = fmtSuggestions(ctx.suggestions, ctx.gameType);

	// Include position context so the AI can reason about the board
	let posContext = "";
	if (ctx.gameType === "chess" && ctx.fen) {
		posContext = ` FEN: ${ctx.fen}.`;
	} else if (ctx.gameType === "janggi" && ctx.fen) {
		posContext = ` FEN: ${ctx.fen}.`;
	} else if (ctx.gameType === "go" && ctx.pgn) {
		posContext = ` Moves so far: ${ctx.pgn}.`;
	}

	// Language instruction
	const langMap: Record<string, string> = {
		ko: " Respond in Korean.",
		es: " Respond in Spanish.",
		vi: " Respond in Vietnamese.",
		mn: " Respond in Mongolian.",
	};
	const langInstr = ctx.language ? (langMap[ctx.language] ?? "") : "";

	return `${game} coach, move ${ctx.moveCount} (${phase}). Human=${player}.${posContext} ${lastMoveStr} Best moves: ${sugs}. In 2-3 sentences: explain the best suggestion and why. Use **bold** for key terms. Under 60 words.${langInstr}`;
}

export interface AnalysisContext {
	gameType: GameType;
	fen: string;
	moveCount: number;
	playerColor: "white" | "black";
	lastMove?: string;
	lastMoveColor?: string;
	suggestions: Suggestion[];
	pgn?: string;
	language?: string;
}

const TIMEOUT_MS = 30000;
const MAX_CONCURRENT = 2;
let activeCalls = 0;

export async function analyzePosition(ctx: AnalysisContext): Promise<string | null> {
	if (activeCalls >= MAX_CONCURRENT) {
		log.debug("skipping analysis, too many concurrent calls");
		return null;
	}

	const prompt = buildPrompt(ctx);
	activeCalls++;

	try {
		const result = await callClaude(prompt);
		return result;
	} catch (err) {
		log.error("analysis failed", { error: (err as Error).message });
		return null;
	} finally {
		activeCalls--;
	}
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
		const result = await callClaudeOpus(prompt);
		return result;
	} catch (err) {
		log.error("game summary failed", { error: (err as Error).message });
		return null;
	}
}

function callClaudeOpus(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error("Claude CLI timeout"));
		}, 45000);

		execFile(
			CLAUDE_BIN,
			[
				"--print",
				"--output-format",
				"text",
				"--no-session-persistence",
				"--max-turns",
				"1",
				"--model",
				"claude-sonnet-4-6",
				"-p",
				prompt,
			],
			{
				timeout: 45000,
				cwd: SANDBOX_DIR,
				maxBuffer: 1024 * 1024,
			},
			(error, stdout, stderr) => {
				clearTimeout(timer);
				if (error) {
					reject(error);
					return;
				}
				if (stderr) {
					log.debug("claude opus stderr", { stderr: stderr.trim() });
				}
				resolve(stdout.trim());
			},
		);
	});
}

function callClaude(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error("Claude CLI timeout"));
		}, TIMEOUT_MS);

		execFile(
			CLAUDE_BIN,
			[
				"--print",
				"--output-format",
				"text",
				"--no-session-persistence",
				"--max-turns",
				"1",
				"--model",
				"claude-haiku-4-5-20251001",
				"-p",
				prompt,
			],
			{
				timeout: TIMEOUT_MS,
				cwd: SANDBOX_DIR,
				maxBuffer: 1024 * 1024,
			},
			(error, stdout, stderr) => {
				clearTimeout(timer);
				if (error) {
					reject(error);
					return;
				}
				if (stderr) {
					log.debug("claude stderr", { stderr: stderr.trim() });
				}
				resolve(stdout.trim());
			},
		);
	});
}

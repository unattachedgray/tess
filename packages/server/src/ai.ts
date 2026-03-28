import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import type { GameType, Suggestion } from "@tess/shared";
import { createLogger } from "./logger.js";

const log = createLogger("ai");

const SANDBOX_DIR = "/tmp/tess-claude-sandbox";
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

	return `${game} coach, move ${ctx.moveCount} (${phase}). Human=${player}. ${lastMoveStr} Best moves: ${sugs}. In 2-3 sentences: explain the best suggestion and why. Use **bold** for key terms. Under 60 words.`;
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
}

const TIMEOUT_MS = 20000;
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

function callClaude(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error("Claude CLI timeout"));
		}, TIMEOUT_MS);

		execFile(
			"claude",
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

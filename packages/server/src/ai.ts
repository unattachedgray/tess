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

function formatSuggestions(suggestions: Suggestion[]): string {
	return suggestions
		.map((s, i) => {
			const score =
				Math.abs(s.score) > 9000
					? `Mate in ${Math.abs(s.score) - 9000}`
					: `${(s.score / 100).toFixed(1)} pawns`;
			return `${i + 1}. ${s.san ?? s.move} (eval: ${score})`;
		})
		.join("\n");
}

function buildChessPrompt(ctx: AnalysisContext): string {
	const phase = getPhase("chess", ctx.moveCount);
	const playerSide = ctx.playerColor === "white" ? "White" : "Black";
	const aiSide = ctx.playerColor === "white" ? "Black" : "White";

	return `Chess coach. Human=${playerSide}, Engine=${aiSide}. No greeting.

Move ${ctx.moveCount}, ${phase}.
FEN: ${ctx.fen}

${ctx.lastMove ? `**Last move (${ctx.lastMoveColor}):** ${ctx.lastMove} — explain the intent and consequence.` : "Game just started. Explain the opening position."}
**Top engine suggestions:**
${formatSuggestions(ctx.suggestions)}

Analyze:
${ctx.lastMove ? "1. Was the last move good or bad? Why?" : `1. What are the key opening principles ${playerSide} should follow?`}
2. What should ${playerSide} focus on now? Pick the best suggestion and explain why it's a strong opening move.
3. Key strategic themes (piece activity, king safety, pawn structure).

Under 120 words. Use **bold** for strategic/tactical terms on first use. End with:

**Terms**
- **term** — brief definition

Include all bolded terms. Skip obvious ones (piece names, check, capture).`;
}

function formatGoSuggestions(suggestions: Suggestion[]): string {
	return suggestions
		.map((s, i) => {
			const winrate = ((s.score + 5000) / 100).toFixed(1);
			return `${i + 1}. ${s.san ?? s.move} (win: ${winrate}%)`;
		})
		.join("\n");
}

function buildGoPrompt(ctx: AnalysisContext): string {
	const phase = getPhase("go", ctx.moveCount);
	const playerSide = ctx.playerColor === "black" ? "Black" : "White";
	const aiSide = ctx.playerColor === "black" ? "White" : "Black";

	return `Go (Baduk) coach. Human=${playerSide}, Engine=${aiSide}. No greeting.

Move ${ctx.moveCount}, ${phase}.

${ctx.lastMove ? `**Last move (${ctx.lastMoveColor}):** ${ctx.lastMove} — explain the intent.` : "Game just started. Explain the opening position."}
**Top engine suggestions:**
${formatGoSuggestions(ctx.suggestions)}

Analyze:
${ctx.lastMove ? "1. Was the last move good or bad? Why?" : `1. What are the key opening principles for ${playerSide}?`}
2. What should ${playerSide} focus on now? Pick the best suggestion and explain the strategic value.
3. Key themes: influence vs territory, thickness, weak groups.

Under 120 words. Use **bold** for Go terms on first use. End with:

**Terms**
- **term** — brief definition

Include all bolded terms. Skip obvious ones (stone, capture, board).`;
}

function buildJanggiPrompt(ctx: AnalysisContext): string {
	const phase = getPhase("janggi", ctx.moveCount);
	const playerSide = ctx.playerColor === "white" ? "Blue (Cho)" : "Red (Han)";
	const aiSide = ctx.playerColor === "white" ? "Red (Han)" : "Blue (Cho)";

	return `Janggi (Korean Chess) coach. Human=${playerSide}, Engine=${aiSide}. No greeting.

Pieces: General(K), Advisor(A), Elephant(B, 1orth+2diag), Horse(N, 1orth+1diag), Chariot(R), Cannon(C, jumps 1 piece), Soldier(P).

Move ${ctx.moveCount}, ${phase}.

${ctx.lastMove ? `**Last move (${ctx.lastMoveColor}):** ${ctx.lastMove} — explain the intent.` : "Game just started. Explain the opening position."}
**Top engine suggestions:**
${formatSuggestions(ctx.suggestions)}

Analyze:
${ctx.lastMove ? "1. Was the last move good or bad? Why?" : `1. What are the key opening principles for ${playerSide}?`}
2. What should ${playerSide} focus on now? Pick the best suggestion and explain why.
3. Key themes: piece activity, general safety, cannon effectiveness.

Under 120 words. Use **bold** for strategic terms on first use. Do NOT use FEN notation in your explanation — use natural language only. End with:

**Terms**
- **term** — brief definition

Include all bolded terms.`;
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

const TIMEOUT_MS = 30000;
const MAX_CONCURRENT = 2;
let activeCalls = 0;

export async function analyzePosition(ctx: AnalysisContext): Promise<string | null> {
	if (activeCalls >= MAX_CONCURRENT) {
		log.debug("skipping analysis, too many concurrent calls");
		return null;
	}

	let prompt: string;
	switch (ctx.gameType) {
		case "go":
			prompt = buildGoPrompt(ctx);
			break;
		case "janggi":
			prompt = buildJanggiPrompt(ctx);
			break;
		default:
			prompt = buildChessPrompt(ctx);
	}

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

/**
 * Post-game evaluation for multiplayer games.
 * Extracted from ws.ts for single-responsibility.
 *
 * Handles:
 * - Chess/Janggi: position-by-position engine replay → accuracy + ACPL
 * - Go: margin-based simplified scoring
 * - AI game summary generation (via Claude CLI)
 */
import { ChessGame, JanggiGame, gameAccuracy, getSkillLevel } from "@tess/shared";
import type { MultiplayerRoom } from "./multiplayerRoom.js";
import type { SessionManager } from "./session.js";
import { generateGameSummary } from "./ai.js";
import { createLogger } from "./logger.js";

const log = createLogger("eval");

export interface EvalClient {
	ws: { readyState: number };
	mpRoom: MultiplayerRoom | null;
	language?: string;
}

export async function evaluateMultiplayerGame(
	room: MultiplayerRoom,
	creatorClient: EvalClient,
	acceptorClient: EvalClient,
	creatorColor: "white" | "black",
	sessionManager: SessionManager,
	send: (ws: unknown, data: unknown) => void,
): Promise<void> {
	const history = room.getMoveHistory();
	const moveCount = room.gameType === "go" ? room.getGoMoves().length : history.length;
	if (moveCount < 4) return;

	const acceptorColor = creatorColor === "white" ? "black" : "white";

	if (room.gameType === "go") {
		await evaluateGoGame(room, creatorClient, acceptorClient, creatorColor, acceptorColor, moveCount, send);
	} else {
		await evaluateChessJanggiGame(room, creatorClient, acceptorClient, creatorColor, acceptorColor, history, sessionManager, send);
	}
}

async function evaluateGoGame(
	room: MultiplayerRoom,
	creatorClient: EvalClient,
	acceptorClient: EvalClient,
	creatorColor: string,
	acceptorColor: string,
	moveCount: number,
	send: (ws: unknown, data: unknown) => void,
): Promise<void> {
	const goResult = room.getResult();
	const margin = parseFloat(goResult.reason.replace(/[^0-9.]/g, "")) || 0;
	const winnerAcc = Math.min(95, 70 + margin * 0.5);
	const loserAcc = Math.max(20, 70 - margin * 0.5);
	const wAcc = goResult.winner === "white" ? winnerAcc : loserAcc;
	const bAcc = goResult.winner === "black" ? winnerAcc : loserAcc;
	const wSkill = getSkillLevel(Math.round(wAcc), "go");
	const bSkill = getSkillLevel(Math.round(bAcc), "go");

	const cAcc = creatorColor === "white" ? wAcc : bAcc;
	const cSkill = creatorColor === "white" ? wSkill : bSkill;
	const aAcc = acceptorColor === "white" ? wAcc : bAcc;
	const aSkill = acceptorColor === "white" ? wSkill : bSkill;

	if (creatorClient.mpRoom === room) {
		send(creatorClient.ws, { type: "SKILL_EVAL", accuracy: Math.round(cAcc), acpl: 0, skill: cSkill });
	}
	if (acceptorClient.mpRoom === room) {
		send(acceptorClient.ws, { type: "SKILL_EVAL", accuracy: Math.round(aAcc), acpl: 0, skill: aSkill });
	}
	log.info("Go eval", { whiteAcc: Math.round(wAcc), blackAcc: Math.round(bAcc) });

	// Generate AI summaries
	await generateSummaries(room, creatorClient, acceptorClient, creatorColor, acceptorColor, cAcc, aAcc, cSkill, aSkill, moveCount, goResult.reason, send);
}

async function evaluateChessJanggiGame(
	room: MultiplayerRoom,
	creatorClient: EvalClient,
	acceptorClient: EvalClient,
	creatorColor: string,
	acceptorColor: string,
	history: { san: string; uci: string; fen: string; moveNumber: number }[],
	sessionManager: SessionManager,
	send: (ws: unknown, data: unknown) => void,
): Promise<void> {
	const evals: number[] = [0];
	const replay = room.gameType === "janggi" ? new JanggiGame() : new ChessGame();
	const pool = room.gameType === "janggi" && sessionManager.hasJanggiPool
		? sessionManager.getJanggiPool()! : sessionManager.getChessPool();
	const variant = room.gameType === "janggi" ? "janggi" : undefined;

	for (const move of history) {
		replay.moveUci(move.uci);
		try {
			const res = await pool.search(replay.fen, 300, 1, variant);
			const score = res.info[0]?.score ?? 0;
			evals.push(replay.turn === "white" ? score : -score);
		} catch {
			evals.push(evals[evals.length - 1] ?? 0);
		}
	}

	log.info("evals", { moves: history.length, evalsLength: evals.length });

	const whiteResult = gameAccuracy(evals, "white", 3);
	const whiteSkill = getSkillLevel(Math.round(whiteResult.accuracy), room.gameType, whiteResult.acpl);
	const blackResult = gameAccuracy(evals, "black", 3);
	const blackSkill = getSkillLevel(Math.round(blackResult.accuracy), room.gameType, blackResult.acpl);

	log.info("accuracy", {
		whiteAcc: Math.round(whiteResult.accuracy), whiteAcpl: whiteResult.acpl,
		blackAcc: Math.round(blackResult.accuracy), blackAcpl: blackResult.acpl,
	});

	const creatorResult = creatorColor === "white" ? whiteResult : blackResult;
	const creatorSkill = creatorColor === "white" ? whiteSkill : blackSkill;
	const acceptorResult = acceptorColor === "white" ? whiteResult : blackResult;
	const acceptorSkill = acceptorColor === "white" ? whiteSkill : blackSkill;

	if (creatorClient.mpRoom === room) {
		send(creatorClient.ws, { type: "SKILL_EVAL", accuracy: Math.round(creatorResult.accuracy), acpl: creatorResult.acpl, skill: creatorSkill });
	}
	if (acceptorClient.mpRoom === room) {
		send(acceptorClient.ws, { type: "SKILL_EVAL", accuracy: Math.round(acceptorResult.accuracy), acpl: acceptorResult.acpl, skill: acceptorSkill });
	}

	const pgn = history.map((m, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ${m.san}` : m.san)).join(" ");
	const gameResult = room.status === "finished" ? "Checkmate" : "Game over";

	await generateSummaries(
		room, creatorClient, acceptorClient, creatorColor, acceptorColor,
		creatorResult.accuracy, acceptorResult.accuracy, creatorSkill, acceptorSkill,
		history.length, gameResult, send, pgn, creatorResult.moveAccuracies, acceptorResult.moveAccuracies,
	);
}

async function generateSummaries(
	room: MultiplayerRoom,
	creatorClient: EvalClient,
	acceptorClient: EvalClient,
	creatorColor: string,
	acceptorColor: string,
	creatorAcc: number,
	acceptorAcc: number,
	creatorSkill: { label: string; rating: string; description: string },
	acceptorSkill: { label: string; rating: string; description: string },
	totalMoves: number,
	result: string,
	send: (ws: unknown, data: unknown) => void,
	pgn?: string,
	creatorMoveAccuracies?: number[],
	acceptorMoveAccuracies?: number[],
): Promise<void> {
	try {
		const [cs, as_] = await Promise.allSettled([
			generateGameSummary({
				gameType: room.gameType,
				playerColor: creatorColor as "white" | "black",
				accuracy: Math.round(creatorAcc),
				acpl: 0,
				skillLabel: creatorSkill.label,
				skillRating: creatorSkill.rating,
				totalMoves,
				result,
				pgn,
				moveAccuracies: creatorMoveAccuracies,
				language: creatorClient.language,
			}),
			generateGameSummary({
				gameType: room.gameType,
				playerColor: acceptorColor as "white" | "black",
				accuracy: Math.round(acceptorAcc),
				acpl: 0,
				skillLabel: acceptorSkill.label,
				skillRating: acceptorSkill.rating,
				totalMoves,
				result,
				pgn,
				moveAccuracies: acceptorMoveAccuracies,
				language: acceptorClient.language,
			}),
		]);
		if (cs.status === "fulfilled" && cs.value && creatorClient.mpRoom === room) {
			send(creatorClient.ws, { type: "GAME_SUMMARY", text: cs.value });
		}
		if (as_.status === "fulfilled" && as_.value && acceptorClient.mpRoom === room) {
			send(acceptorClient.ws, { type: "GAME_SUMMARY", text: as_.value });
		}
		log.info("summaries sent", { creator: cs.status, acceptor: as_.status });
	} catch (err) {
		log.error("summary failed", { error: (err as Error).message });
	}
}

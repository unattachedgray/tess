/**
 * Post-game evaluation for multiplayer games.
 *
 * Uses incrementally accumulated engine evals from during gameplay.
 * No post-game engine replay needed — SKILL_EVAL is instant.
 * Claude AI narrative runs in background.
 */
import { gameAccuracy, getSkillLevel } from "@tess/shared";
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
	_sessionManager: SessionManager,
	send: (ws: unknown, data: unknown) => void,
): Promise<void> {
	const history = room.getMoveHistory();
	const moveCount = room.gameType === "go" ? room.getGoMoves().length : history.length;
	if (moveCount < 4) return;

	const acceptorColor = creatorColor === "white" ? "black" : "white";
	const evals = room.getPositionEvals();

	log.info("post-game eval", {
		gameType: room.gameType,
		moves: moveCount,
		evalsCollected: evals.length - 1, // subtract initial 0
	});

	let whiteResult: { accuracy: number; acpl: number; moveAccuracies: number[] };
	let blackResult: { accuracy: number; acpl: number; moveAccuracies: number[] };
	let whiteSkill: { label: string; rating: string; description: string };
	let blackSkill: { label: string; rating: string; description: string };

	if (room.gameType === "go") {
		// Go: compute ACPL directly from scoreLead-based evals.
		// Can't use gameAccuracy() because its winPercent() function saturates.
		if (evals.length > moveCount * 0.5) {
			const computeGoAcpl = (color: "white" | "black") => {
				let totalLoss = 0, movesSeen = 0;
				for (let i = 1; i < evals.length; i++) {
					// In Go, BLACK moves first: odd indices = black's moves, even = white's
					const isPlayerMove = color === "black" ? i % 2 === 1 : i % 2 === 0;
					if (!isPlayerMove) continue;
					if (Math.ceil(i / 2) <= 6) continue; // skip opening

					// Centipawn loss from this player's perspective
					const evalBefore = color === "white" ? evals[i - 1] : -evals[i - 1];
					const evalAfter = color === "white" ? evals[i] : -evals[i];
					const cpLoss = Math.max(0, evalBefore - evalAfter);
					totalLoss += cpLoss;
					movesSeen++;
				}
				const acpl = movesSeen > 0 ? Math.round(totalLoss / movesSeen) : 0;
				// Convert ACPL to accuracy: 0 ACPL = 100%, 500+ ACPL = 0%
				const accuracy = Math.max(0, Math.min(100, 100 - acpl * 0.2));
				return { accuracy, acpl, moveAccuracies: [] as number[] };
			};
			whiteResult = computeGoAcpl("white");
			blackResult = computeGoAcpl("black");
			log.info("Go eval (scoreLead)", { wAcpl: whiteResult.acpl, bAcpl: blackResult.acpl, wAcc: Math.round(whiteResult.accuracy), bAcc: Math.round(blackResult.accuracy), firstEvals: evals.slice(0, 15) });
		} else {
			// Fallback: estimate from game result margin
			const goResult = room.getResult();
			const margin = parseFloat(goResult.reason.replace(/[^0-9.]/g, "")) || 0;
			const winnerAcc = Math.min(95, 70 + margin * 0.5);
			const loserAcc = Math.max(20, 70 - margin * 0.5);
			const wAcc = goResult.winner === "white" ? winnerAcc : loserAcc;
			const bAcc = goResult.winner === "black" ? winnerAcc : loserAcc;
			whiteResult = { accuracy: wAcc, acpl: 0, moveAccuracies: [] };
			blackResult = { accuracy: bAcc, acpl: 0, moveAccuracies: [] };
		}
		whiteSkill = getSkillLevel(Math.round(whiteResult.accuracy), "go", whiteResult.acpl);
		blackSkill = getSkillLevel(Math.round(blackResult.accuracy), "go", blackResult.acpl);
	} else {
		// Chess/Janggi: use accumulated evals
		if (evals.length > moveCount * 0.5) {
			whiteResult = gameAccuracy(evals, "white", 3);
			blackResult = gameAccuracy(evals, "black", 3);
		} else {
			// Not enough evals (shouldn't happen in normal play)
			log.warn("insufficient evals, skipping accuracy", { evals: evals.length, moves: moveCount });
			whiteResult = { accuracy: 0, acpl: 0, moveAccuracies: [] };
			blackResult = { accuracy: 0, acpl: 0, moveAccuracies: [] };
		}
		whiteSkill = getSkillLevel(Math.round(whiteResult.accuracy), room.gameType, whiteResult.acpl);
		blackSkill = getSkillLevel(Math.round(blackResult.accuracy), room.gameType, blackResult.acpl);
	}

	log.info("accuracy", {
		whiteAcc: Math.round(whiteResult.accuracy), whiteAcpl: whiteResult.acpl,
		blackAcc: Math.round(blackResult.accuracy), blackAcpl: blackResult.acpl,
	});

	// Map to creator/acceptor
	const creatorResult = creatorColor === "white" ? whiteResult : blackResult;
	const creatorSkill = creatorColor === "white" ? whiteSkill : blackSkill;
	const acceptorResult = acceptorColor === "white" ? whiteResult : blackResult;
	const acceptorSkill = acceptorColor === "white" ? whiteSkill : blackSkill;

	// Send SKILL_EVAL immediately (no engine work needed)
	if (creatorClient.mpRoom === room) {
		send(creatorClient.ws, {
			type: "SKILL_EVAL",
			accuracy: Math.round(creatorResult.accuracy),
			acpl: creatorResult.acpl,
			skill: creatorSkill,
			opponentAccuracy: Math.round(acceptorResult.accuracy),
			opponentAcpl: acceptorResult.acpl,
			opponentSkill: acceptorSkill,
		});
	}
	if (acceptorClient.mpRoom === room) {
		send(acceptorClient.ws, {
			type: "SKILL_EVAL",
			accuracy: Math.round(acceptorResult.accuracy),
			acpl: acceptorResult.acpl,
			skill: acceptorSkill,
			opponentAccuracy: Math.round(creatorResult.accuracy),
			opponentAcpl: creatorResult.acpl,
			opponentSkill: creatorSkill,
		});
	}

	// Generate Claude narrative in background (non-blocking)
	const pgn = history.length > 0
		? history.map((m, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ${m.san}` : m.san)).join(" ")
		: undefined;
	const gameResult = room.getResult().reason;

	generateSummaries(
		room, creatorClient, acceptorClient, creatorColor, acceptorColor,
		creatorResult.accuracy, acceptorResult.accuracy, creatorSkill, acceptorSkill,
		moveCount, gameResult, send, pgn, creatorResult.moveAccuracies, acceptorResult.moveAccuracies,
	).catch(err => log.error("summary generation failed", { error: (err as Error).message }));
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
}

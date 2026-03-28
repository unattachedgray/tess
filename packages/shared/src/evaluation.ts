/**
 * Player skill evaluation based on move accuracy.
 * Uses the Lichess accuracy formula (open source, game-agnostic).
 *
 * The system works for all 3 games:
 * - Chess/Janggi: uses centipawn evaluations from Stockfish
 * - Go: uses KataGo score estimates converted to centipawn-equivalents
 */

/** Convert centipawn evaluation to win percentage (0-100) */
export function winPercent(centipawns: number): number {
	// Lichess formula from WinPercent.scala
	const MULTIPLIER = -0.00368208;
	return 50 + 50 * (2 / (1 + Math.exp(MULTIPLIER * centipawns)) - 1);
}

/** Compute per-move accuracy (0-100) from win% before and after the move */
export function moveAccuracy(winPercentBefore: number, winPercentAfter: number): number {
	// Lichess formula from AccuracyPercent.scala
	const winDiff = Math.max(0, winPercentBefore - winPercentAfter);
	const raw = 103.1668 * Math.exp(-0.04354 * winDiff) - 3.1669;
	return Math.min(100, Math.max(0, raw));
}

/** Compute game accuracy from an array of centipawn evaluations for each position */
export function gameAccuracy(
	evals: number[],
	playerColor: "white" | "black",
	skipOpeningMoves = 6,
): { accuracy: number; acpl: number; moveAccuracies: number[] } {
	const moveAccuracies: number[] = [];
	let totalCpLoss = 0;
	let cpLossMoves = 0;

	for (let i = 1; i < evals.length; i++) {
		// Only evaluate the player's moves (odd indices for white, even for black)
		const isPlayerMove = playerColor === "white" ? i % 2 === 1 : i % 2 === 0;
		if (!isPlayerMove) continue;

		// Skip opening moves
		const moveNum = Math.ceil(i / 2);
		if (moveNum <= skipOpeningMoves) continue;

		const evalBefore = playerColor === "white" ? evals[i - 1] : -evals[i - 1];
		const evalAfter = playerColor === "white" ? evals[i] : -evals[i];

		const wpBefore = winPercent(evalBefore);
		const wpAfter = winPercent(evalAfter);
		const acc = moveAccuracy(wpBefore, wpAfter);
		moveAccuracies.push(acc);

		// ACPL (centipawn loss)
		const cpLoss = Math.max(0, evalBefore - evalAfter);
		totalCpLoss += cpLoss;
		cpLossMoves++;
	}

	if (moveAccuracies.length === 0) {
		return { accuracy: 0, acpl: 0, moveAccuracies: [] };
	}

	// Harmonic mean (penalizes blunders more than arithmetic mean)
	const harmonicSum = moveAccuracies.reduce((sum, a) => sum + 1 / Math.max(a, 0.1), 0);
	const harmonicMean = moveAccuracies.length / harmonicSum;

	// Arithmetic mean
	const arithmeticMean = moveAccuracies.reduce((a, b) => a + b, 0) / moveAccuracies.length;

	// Final: average of harmonic and arithmetic (Lichess approach)
	const accuracy = (harmonicMean + arithmeticMean) / 2;
	const acpl = cpLossMoves > 0 ? totalCpLoss / cpLossMoves : 0;

	return { accuracy, acpl: Math.round(acpl), moveAccuracies };
}

export interface SkillLevel {
	label: string;
	rating: string;
	description: string;
}

/** Map game accuracy to a skill level */
export function getSkillLevel(accuracy: number, gameType: "chess" | "go" | "janggi"): SkillLevel {
	// Chess/Janggi accuracy-to-rating mapping
	if (gameType === "chess" || gameType === "janggi") {
		if (accuracy >= 95)
			return { label: "Engine", rating: "2800+", description: "Near-perfect engine play" };
		if (accuracy >= 90)
			return { label: "Grandmaster", rating: "2500-2700", description: "World-class accuracy" };
		if (accuracy >= 82)
			return { label: "Master", rating: "2200-2500", description: "Master-level precision" };
		if (accuracy >= 72)
			return { label: "Expert", rating: "2000-2200", description: "Expert-level play" };
		if (accuracy >= 62)
			return { label: "Advanced", rating: "1800-2000", description: "Strong club player" };
		if (accuracy >= 50)
			return { label: "Intermediate", rating: "1500-1800", description: "Average club player" };
		if (accuracy >= 35)
			return { label: "Casual", rating: "1200-1500", description: "Developing player" };
		return { label: "Beginner", rating: "Under 1200", description: "Learning the basics" };
	}

	// Go accuracy-to-rank mapping
	if (accuracy >= 95)
		return { label: "Pro", rating: "9 dan+", description: "Professional-level play" };
	if (accuracy >= 88)
		return { label: "High Dan", rating: "4-6 dan", description: "Very strong amateur" };
	if (accuracy >= 78) return { label: "Dan", rating: "1-3 dan", description: "Dan-level player" };
	if (accuracy >= 65)
		return { label: "High Kyu", rating: "1-3 kyu", description: "Strong kyu player" };
	if (accuracy >= 50)
		return { label: "Mid Kyu", rating: "4-8 kyu", description: "Intermediate player" };
	if (accuracy >= 35)
		return { label: "Low Kyu", rating: "9-15 kyu", description: "Developing player" };
	return { label: "Beginner", rating: "16+ kyu", description: "Learning the basics" };
}

/** Convert Go score (KataGo points) to centipawn equivalent */
export function goScoreToCentipawns(scoreLead: number): number {
	// 1 point in Go ≈ 100 centipawns (rough equivalence)
	return Math.round(scoreLead * 100);
}

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

/**
 * SKILL_SCALE — single source of truth for skill tiers.
 *
 * Labels match the AI difficulty tiers (Beginner/Casual/Club/Pro/Superhuman)
 * with sub-tiers (+) for finer resolution. All evaluation, difficulty labels,
 * and UI display derive from this array.
 *
 * Each tier defines:
 *  - maxAcpl: upper ACPL bound (play at or below this → tier applies)
 *  - maxAccuracy: fallback accuracy bound (when ACPL unavailable)
 *  - chess/janggi rating + Go rating strings
 *
 * Thresholds calibrated from autoplay simulations:
 *  - Chess/Janggi: Fairy-Stockfish UCI_LimitStrength at various Elo levels
 *  - Go: KataGo visit-budget simulations (10 visits → 18 kyu, 5000 → Pro+)
 *
 * Order: strongest first (lowest ACPL). getSkillLevel() iterates and returns
 * the first tier where the player's ACPL is within maxAcpl.
 */
/**
 * Per-game rating keys. Each game has independent calibration
 * from autoplay simulations with the respective engine.
 */
export type GameRatingKey = "chess" | "janggi" | "go";

export interface SkillTier {
	label: string;
	/** Max ACPL to qualify for this tier — per game, independently calibrated */
	maxAcpl: Record<GameRatingKey, number>;
	/** Fallback: min accuracy to qualify (when ACPL unavailable) */
	maxAccuracy: Record<GameRatingKey, number>;
	/** Human-readable rating range for display */
	rating: Record<GameRatingKey, string>;
	description: string;
	/**
	 * AI difficulty target per game.
	 * chessElo/janggiElo: UCI_LimitStrength Elo (null = full engine).
	 * goVisits: KataGo visit budget.
	 * Only set for tiers that map to selectable difficulty levels.
	 */
	aiTarget?: { chessElo: number | null; janggiElo: number | null; goVisits: number };
}

/**
 * SKILL_SCALE — single source of truth for all skill tiers.
 *
 * All evaluation labels, difficulty descriptions, and UI displays
 * derive from this array. To recalibrate, change these numbers.
 *
 * Calibrated from autoplay simulations per engine:
 *  - Chess: Fairy-Stockfish UCI_LimitStrength sims
 *  - Janggi: Fairy-Stockfish janggi variant sims (higher ACPL thresholds
 *    due to volatile positions — cannons, palace, jumping rules)
 *  - Go: KataGo visit-budget sims
 */
export const SKILL_SCALE: SkillTier[] = [
	{
		label: "Superhuman",
		maxAcpl: { chess: 25, janggi: 30, go: 20 },
		maxAccuracy: { chess: 95, janggi: 95, go: 95 },
		rating: { chess: "2800+", janggi: "2800+", go: "9 dan+" },
		description: "Engine-level precision",
		aiTarget: { chessElo: null, janggiElo: null, goVisits: 5000 },
	},
	{
		label: "Pro+",
		maxAcpl: { chess: 45, janggi: 55, go: 40 },
		maxAccuracy: { chess: 88, janggi: 88, go: 88 },
		rating: { chess: "2500-2800", janggi: "2500-2800", go: "4-6 dan" },
		description: "Near-professional accuracy",
	},
	{
		label: "Pro",
		maxAcpl: { chess: 75, janggi: 90, go: 80 },
		maxAccuracy: { chess: 78, janggi: 78, go: 78 },
		rating: { chess: "2200-2500", janggi: "2200-2500", go: "1-3 dan" },
		description: "Professional-level play",
		aiTarget: { chessElo: 2200, janggiElo: 2200, goVisits: 1000 },
	},
	{
		label: "Club+",
		maxAcpl: { chess: 120, janggi: 140, go: 130 },
		maxAccuracy: { chess: 68, janggi: 68, go: 65 },
		rating: { chess: "1800-2200", janggi: "1800-2200", go: "1-3 kyu" },
		description: "Strong club player",
	},
	{
		label: "Club",
		maxAcpl: { chess: 180, janggi: 210, go: 200 },
		maxAccuracy: { chess: 55, janggi: 55, go: 50 },
		rating: { chess: "1600-1800", janggi: "1600-1800", go: "4-8 kyu" },
		description: "Solid club player",
		aiTarget: { chessElo: 1600, janggiElo: 1600, goVisits: 200 },
	},
	{
		label: "Casual+",
		maxAcpl: { chess: 260, janggi: 300, go: 300 },
		maxAccuracy: { chess: 42, janggi: 42, go: 35 },
		rating: { chess: "1400-1600", janggi: "1400-1600", go: "9-12 kyu" },
		description: "Above-average casual",
	},
	{
		label: "Casual",
		maxAcpl: { chess: 350, janggi: 400, go: 400 },
		maxAccuracy: { chess: 28, janggi: 28, go: 22 },
		rating: { chess: "1200-1400", janggi: "1200-1400", go: "13-15 kyu" },
		description: "Casual player",
		aiTarget: { chessElo: 1200, janggiElo: 1200, goVisits: 50 },
	},
];

export const BEGINNER_TIER = {
	label: "Beginner",
	rating: { chess: "Under 1200", janggi: "Under 1200", go: "16+ kyu" } as Record<
		GameRatingKey,
		string
	>,
	description: "Learning the basics",
	aiTarget: { chessElo: 800, janggiElo: 800, goVisits: 10 },
};

/** Get the AI target for a difficulty ID */
export function getDifficultyTarget(
	id: string,
): { chessElo: number | null; janggiElo: number | null; goVisits: number } | undefined {
	if (id === "beginner") return BEGINNER_TIER.aiTarget;
	const tier = SKILL_SCALE.find((t) => t.label.toLowerCase() === id && t.aiTarget);
	return tier?.aiTarget;
}

/** Get the display rating for a difficulty+game combo */
export function getDifficultyRating(id: string, gameType: GameRatingKey): string {
	if (id === "beginner") return BEGINNER_TIER.rating[gameType];
	const tier = SKILL_SCALE.find((t) => t.label.toLowerCase() === id);
	return tier?.rating[gameType] ?? BEGINNER_TIER.rating[gameType];
}

/**
 * Map ACPL/accuracy to a skill level.
 * Derives all labels from SKILL_SCALE — change the scale and every
 * evaluation, display, and difficulty label updates automatically.
 */
export function getSkillLevel(
	accuracy: number,
	gameType: "chess" | "go" | "janggi",
	acpl?: number,
): SkillLevel {
	const ratingKey: GameRatingKey = gameType;

	// ACPL-based (primary, more reliable)
	if (acpl !== undefined && acpl > 0) {
		for (const tier of SKILL_SCALE) {
			if (acpl <= tier.maxAcpl[ratingKey]) {
				return { label: tier.label, rating: tier.rating[ratingKey], description: tier.description };
			}
		}
		return {
			label: BEGINNER_TIER.label,
			rating: BEGINNER_TIER.rating[ratingKey],
			description: BEGINNER_TIER.description,
		};
	}

	// Accuracy-based fallback (when ACPL unavailable)
	for (const tier of SKILL_SCALE) {
		if (accuracy >= tier.maxAccuracy[ratingKey]) {
			return { label: tier.label, rating: tier.rating[ratingKey], description: tier.description };
		}
	}
	return {
		label: BEGINNER_TIER.label,
		rating: BEGINNER_TIER.rating[ratingKey],
		description: BEGINNER_TIER.description,
	};
}

/** Convert Go score (KataGo points) to centipawn equivalent */
export function goScoreToCentipawns(scoreLead: number): number {
	// 1 point in Go ≈ 100 centipawns (rough equivalence)
	return Math.round(scoreLead * 100);
}

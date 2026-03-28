import type { DifficultyTier } from "@tess/shared";

/**
 * Difficulty calibration based on real-world ratings.
 *
 * Chess/Janggi: Uses UCI_LimitStrength + UCI_Elo for realistic play.
 * Fairy-Stockfish supports Elo range 500-2850. Movetime is kept moderate
 * (500ms) so the engine has time to "think" at its limited level.
 *
 * Go: Uses KataGo visit budgets. Fewer visits = weaker play.
 * Calibrated from KaTrain data (sanderland/katrain).
 *
 * Suggestion search always uses full strength regardless of difficulty.
 */

export const DIFFICULTY_TIERS: DifficultyTier[] = [
	{
		id: "beginner",
		label: "Beginner",
		// Chess: ~800 Elo (makes frequent blunders, misses tactics)
		chessMovetime: 500,
		chessLabel: "~800 Elo",
		// Go: 10 visits ≈ 15-20 kyu (random-looking play)
		goVisits: 10,
		goLabel: "~18 kyu",
		// Janggi: similar to chess beginner
		janggiMovetime: 500,
		janggiLabel: "~9급",
	},
	{
		id: "casual",
		label: "Casual",
		// Chess: ~1200 Elo (knows basics, misses complex tactics)
		chessMovetime: 500,
		chessLabel: "~1200 Elo",
		// Go: 50 visits ≈ 8-12 kyu
		goVisits: 50,
		goLabel: "~10 kyu",
		janggiMovetime: 500,
		janggiLabel: "~5급",
	},
	{
		id: "club",
		label: "Club",
		// Chess: ~1600 Elo (solid club player)
		chessMovetime: 500,
		chessLabel: "~1600 Elo",
		// Go: 200 visits ≈ 3-5 kyu
		goVisits: 200,
		goLabel: "~4 kyu",
		janggiMovetime: 500,
		janggiLabel: "~2단",
	},
	{
		id: "pro",
		label: "Pro",
		// Chess: ~2200 Elo (master-level)
		chessMovetime: 500,
		chessLabel: "~2200 Elo",
		// Go: 1000 visits ≈ 1-3 dan
		goVisits: 1000,
		goLabel: "~2 dan",
		janggiMovetime: 500,
		janggiLabel: "~5단",
	},
	{
		id: "superhuman",
		label: "Superhuman",
		// Chess: ~2800 Elo (engine strength, no limiting)
		chessMovetime: 1000,
		chessLabel: "~2800+ Elo",
		// Go: 5000 visits ≈ 7+ dan / pro level
		goVisits: 5000,
		goLabel: "Pro+",
		janggiMovetime: 1000,
		janggiLabel: "~7단+",
	},
];

/** Elo targets for UCI_LimitStrength (chess/janggi) */
export const DIFFICULTY_ELO: Record<string, number | null> = {
	beginner: 800,
	casual: 1200,
	club: 1600,
	pro: 2200,
	superhuman: null, // no limit — full engine strength
};

/** Movetime for suggestion searches (always full strength) */
export const FULL_STRENGTH_MOVETIME = 1000;

export function getTier(id: string): DifficultyTier | undefined {
	return DIFFICULTY_TIERS.find((t) => t.id === id);
}

export function getElo(id: string): number | null {
	return DIFFICULTY_ELO[id] ?? null;
}

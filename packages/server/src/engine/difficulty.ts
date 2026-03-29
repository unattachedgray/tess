/**
 * Difficulty configuration — derived from the shared SKILL_SCALE.
 *
 * Engine settings (Elo limits, movetimes, KataGo visits) are the
 * single source of truth in SKILL_SCALE / BEGINNER_TIER. This file
 * provides convenient accessors for the server engine layer.
 */
import type { DifficultyTier } from "@tess/shared";
import { SKILL_SCALE, BEGINNER_TIER } from "@tess/shared";

/** Movetime for suggestion searches (always full strength) */
export const FULL_STRENGTH_MOVETIME = 1000;

/**
 * Build DIFFICULTY_TIERS from shared SKILL_SCALE.
 * Maps difficulty IDs (beginner/casual/club/pro/superhuman) to engine settings.
 */
function buildTiers(): DifficultyTier[] {
	const tiers: DifficultyTier[] = [];

	// Beginner
	const bt = BEGINNER_TIER.aiTarget;
	tiers.push({
		id: "beginner",
		label: "Beginner",
		chessMovetime: 500,
		chessLabel: `~${BEGINNER_TIER.rating.chess}`,
		goVisits: bt.goVisits,
		goLabel: `~${BEGINNER_TIER.rating.go}`,
		janggiMovetime: 500,
		janggiLabel: `~${BEGINNER_TIER.rating.janggi}`,
	});

	// Scale tiers with aiTarget (Casual, Club, Pro, Superhuman)
	const tierMap: Record<string, string> = {
		casual: "Casual",
		club: "Club",
		pro: "Pro",
		superhuman: "Superhuman",
	};

	for (const [id, label] of Object.entries(tierMap)) {
		const scaleTier = SKILL_SCALE.find(
			(t) => t.label.toLowerCase() === id && t.aiTarget,
		);
		if (!scaleTier || !scaleTier.aiTarget) continue;
		const at = scaleTier.aiTarget;
		const isSuperhuman = id === "superhuman";
		tiers.push({
			id: id as DifficultyTier["id"],
			label,
			chessMovetime: isSuperhuman ? 1000 : 500,
			chessLabel: `~${scaleTier.rating.chess}`,
			goVisits: at.goVisits,
			goLabel: `~${scaleTier.rating.go}`,
			janggiMovetime: isSuperhuman ? 1000 : 500,
			janggiLabel: `~${scaleTier.rating.janggi}`,
		});
	}

	return tiers;
}

export const DIFFICULTY_TIERS: DifficultyTier[] = buildTiers();

/** Elo targets for UCI_LimitStrength (chess/janggi) — derived from SKILL_SCALE */
export const DIFFICULTY_ELO: Record<string, number | null> = {
	beginner: BEGINNER_TIER.aiTarget.chessElo,
	...Object.fromEntries(
		SKILL_SCALE.filter((t) => t.aiTarget)
			.map((t) => [t.label.toLowerCase(), t.aiTarget!.chessElo]),
	),
};

export function getTier(id: string): DifficultyTier | undefined {
	return DIFFICULTY_TIERS.find((t) => t.id === id);
}

export function getElo(id: string): number | null {
	return DIFFICULTY_ELO[id] ?? null;
}

import type { DifficultyTier } from "@tess/shared";

export const DIFFICULTY_TIERS: DifficultyTier[] = [
	{
		id: "beginner",
		label: "Beginner",
		chessMovetime: 50,
		chessLabel: "~1000 Elo",
		goVisits: 10,
		goLabel: "~20 kyu",
		janggiMovetime: 75,
		janggiLabel: "~9급",
	},
	{
		id: "casual",
		label: "Casual",
		chessMovetime: 200,
		chessLabel: "~1500 Elo",
		goVisits: 75,
		goLabel: "~8 kyu",
		janggiMovetime: 300,
		janggiLabel: "~5급",
	},
	{
		id: "club",
		label: "Club",
		chessMovetime: 1000,
		chessLabel: "~2000 Elo",
		goVisits: 400,
		goLabel: "~3 dan",
		janggiMovetime: 1200,
		janggiLabel: "~2단",
	},
	{
		id: "pro",
		label: "Pro",
		chessMovetime: 3000,
		chessLabel: "~2500 Elo",
		goVisits: 2000,
		goLabel: "~9 dan",
		janggiMovetime: 3500,
		janggiLabel: "~5단",
	},
	{
		id: "superhuman",
		label: "Superhuman",
		chessMovetime: 5000,
		chessLabel: "~2800+ Elo",
		goVisits: 8000,
		goLabel: "Superhuman",
		janggiMovetime: 5000,
		janggiLabel: "~7단+",
	},
];

export const FULL_STRENGTH_MOVETIME = 5000;

export function getTier(id: string): DifficultyTier | undefined {
	return DIFFICULTY_TIERS.find((t) => t.id === id);
}

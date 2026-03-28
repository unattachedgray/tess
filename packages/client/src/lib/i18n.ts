/**
 * Internationalization foundation.
 * All UI strings go through t() for future translation.
 * Currently English-only — add languages by extending TRANSLATIONS.
 */

export type Language = "en" | "ko" | "es" | "vi" | "mn";

const TRANSLATIONS: Record<Language, Record<string, string>> = {
	en: {
		// Game types
		"game.chess": "Chess",
		"game.go": "Go",
		"game.janggi": "Janggi",

		// Difficulty
		"difficulty.beginner": "Beginner",
		"difficulty.casual": "Casual",
		"difficulty.club": "Club",
		"difficulty.pro": "Pro",
		"difficulty.superhuman": "Superhuman",

		// Game UI
		"game.yourTurn": "Your turn",
		"game.aiThinking": "AI is thinking...",
		"game.check": "Check!",
		"game.inCheck": "You're in check!",
		"game.youWin": "You win",
		"game.youLose": "You lose",
		"game.draw": "Draw",
		"game.newGame": "New Game",
		"game.resign": "Resign",
		"game.hint": "Hint",
		"game.moves": "Moves",
		"game.noMoves": "No moves yet",

		// Settings
		"settings.suggestions": "Suggestions",
		"settings.analysisDepth": "Analysis depth",
		"settings.aiCoach": "AI Coach",
		"settings.autoplay": "Autoplay",
		"settings.humanElo": "Human player Elo",

		// Analysis
		"analysis.aiCoach": "AI Coach",
		"analysis.makeMove": "Make a move to get coaching feedback",
		"analysis.afterMove": "After move",
		"analysis.earlier": "(earlier)",
		"analysis.writingReview": "Writing review...",

		// Engine
		"engine.title": "Engine",
		"engine.bestMove": "Best move",
		"engine.goodMove": "Good move",
		"engine.ok": "OK",
		"engine.inaccuracy": "Inaccuracy",
		"engine.mistake": "Mistake",
		"engine.blunder": "Blunder",

		// Skill
		"skill.gameReview": "Game Review",
		"skill.accuracy": "Accuracy",

		// Menu
		"menu.game": "Game",
		"menu.boardSize": "Board Size",
		"menu.playAs": "Play as",
		"menu.difficulty": "Difficulty",

		// Header
		"header.online": "online",
		"header.menu": "Menu",
		"header.close": "Close",

		// Colors
		"color.white": "White",
		"color.black": "Black",
		"color.blue": "Blue (Cho)",
		"color.red": "Red (Han)",
	},
	ko: {},
	es: {},
	vi: {},
	mn: {},
};

let currentLang: Language = "en";

export function setLanguage(lang: Language): void {
	currentLang = lang;
}

export function getLanguage(): Language {
	return currentLang;
}

export function t(key: string): string {
	return TRANSLATIONS[currentLang]?.[key] ?? TRANSLATIONS.en[key] ?? key;
}

export const LANGUAGES: { code: Language; name: string }[] = [
	{ code: "en", name: "English" },
	{ code: "ko", name: "한국어" },
	{ code: "es", name: "Español" },
	{ code: "vi", name: "Tiếng Việt" },
	{ code: "mn", name: "Монгол" },
];

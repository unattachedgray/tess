import { describe, expect, it } from "vitest";
import {
	accuracyFromMoves,
	classifyMoveQuality,
	gameAccuracy,
	getSkillLevel,
	moveAccuracy,
	winPercent,
} from "./evaluation.js";

describe("classifyMoveQuality", () => {
	it("maps cp-loss bands to quality labels", () => {
		expect(classifyMoveQuality(0)).toBe("best");
		expect(classifyMoveQuality(10)).toBe("best");
		expect(classifyMoveQuality(20)).toBe("good");
		expect(classifyMoveQuality(40)).toBe("ok");
		expect(classifyMoveQuality(80)).toBe("inaccuracy");
		expect(classifyMoveQuality(150)).toBe("mistake");
		expect(classifyMoveQuality(500)).toBe("blunder");
	});
});

describe("accuracyFromMoves", () => {
	it("perfect play scores near 100 with 0 ACPL", () => {
		const moves = Array.from({ length: 20 }, () => ({ evalBefore: 20, cpLoss: 0 }));
		const result = accuracyFromMoves(moves, 6);
		expect(result.accuracy).toBeGreaterThan(95);
		expect(result.acpl).toBe(0);
		expect(result.moveAccuracies).toHaveLength(14);
	});

	it("repeated blunders score low with high ACPL", () => {
		const moves = Array.from({ length: 20 }, () => ({ evalBefore: 0, cpLoss: 300 }));
		const result = accuracyFromMoves(moves, 0);
		expect(result.accuracy).toBeLessThan(50);
		expect(result.acpl).toBe(300);
	});

	it("skips opening moves", () => {
		const moves = [
			{ evalBefore: 0, cpLoss: 900 }, // opening blunder, skipped
			{ evalBefore: 0, cpLoss: 900 },
			{ evalBefore: 0, cpLoss: 0 },
			{ evalBefore: 0, cpLoss: 0 },
		];
		const result = accuracyFromMoves(moves, 2);
		expect(result.acpl).toBe(0);
		expect(result.moveAccuracies).toHaveLength(2);
	});

	it("returns zeros when nothing to evaluate", () => {
		expect(accuracyFromMoves([], 6)).toEqual({ accuracy: 0, acpl: 0, moveAccuracies: [] });
	});

	it("agrees with gameAccuracy on equivalent input", () => {
		// White plays 10 moves each losing 50cp; black perfectly restores nothing.
		// gameAccuracy path: evals alternate white-move drops.
		const evals = [0];
		for (let i = 0; i < 10; i++) {
			evals.push(evals[evals.length - 1] - 50); // white move loses 50
			evals.push(evals[evals.length - 1]); // black move keeps eval
		}
		const viaEvals = gameAccuracy(evals, "white", 0);
		const viaMoves = accuracyFromMoves(
			Array.from({ length: 10 }, (_, i) => ({ evalBefore: -50 * i, cpLoss: 50 })),
			0,
		);
		expect(viaMoves.acpl).toBe(viaEvals.acpl);
		expect(Math.abs(viaMoves.accuracy - viaEvals.accuracy)).toBeLessThan(1);
	});
});

describe("winPercent", () => {
	it("returns 50% for equal position", () => {
		expect(winPercent(0)).toBeCloseTo(50, 0);
	});

	it("returns ~75% for +300cp advantage", () => {
		const wp = winPercent(300);
		expect(wp).toBeGreaterThan(70);
		expect(wp).toBeLessThan(85);
	});

	it("returns ~25% for -300cp disadvantage", () => {
		const wp = winPercent(-300);
		expect(wp).toBeGreaterThan(15);
		expect(wp).toBeLessThan(30);
	});

	it("returns ~99% for +1000cp", () => {
		expect(winPercent(1000)).toBeGreaterThan(95);
	});
});

describe("moveAccuracy", () => {
	it("returns ~100 for a perfect move (no win% change)", () => {
		const acc = moveAccuracy(50, 50);
		expect(acc).toBeGreaterThan(99);
	});

	it("returns ~64 for 10% win loss", () => {
		const acc = moveAccuracy(60, 50);
		expect(acc).toBeGreaterThan(55);
		expect(acc).toBeLessThan(75);
	});

	it("returns low accuracy for a big blunder (40% win loss)", () => {
		const acc = moveAccuracy(80, 40);
		expect(acc).toBeLessThan(25);
	});

	it("returns 0 for total blunder (50% -> 0%)", () => {
		const acc = moveAccuracy(50, 0);
		expect(acc).toBeLessThan(15);
	});
});

describe("gameAccuracy", () => {
	it("returns high accuracy for a perfect game", () => {
		// All evals near 0 — both sides play perfectly
		const evals = [0, 5, 3, 8, 2, 10, 5, 12, 8, 15, 10, 18, 12, 20, 15, 22, 18, 25, 20];
		const result = gameAccuracy(evals, "white", 2);
		expect(result.accuracy).toBeGreaterThan(85);
	});

	it("returns low accuracy for a blunder-filled game", () => {
		// Evals from white's perspective. White blunders every move.
		// Position: 0 → White plays → -200 → Black plays → -100 → White plays → -400 → ...
		const evals = [0, -200, -100, -400, -50, -500, 0, -600, 50, -700, 100, -800, 50, -900];
		const result = gameAccuracy(evals, "white", 0);
		expect(result.accuracy).toBeLessThan(40);
	});

	it("computes ACPL correctly", () => {
		// Simple: white makes consistent 50cp losses
		const evals = [0, -50, 0, -50, 0, -50, 0, -50, 0, -50, 0, -50, 0, -50, 0];
		const result = gameAccuracy(evals, "white", 0);
		expect(result.acpl).toBeGreaterThan(30);
	});

	it("skips opening moves", () => {
		// First 6 moves are opening — should be skipped
		const evals = Array(14).fill(0); // 7 move pairs, all equal
		evals.push(-500); // blunder on move 8
		const resultSkip = gameAccuracy(evals, "white", 6);
		const resultNoSkip = gameAccuracy(evals, "white", 0);
		// With skip, the blunder is the only evaluated move
		expect(resultSkip.moveAccuracies.length).toBeLessThan(resultNoSkip.moveAccuracies.length);
	});
});

describe("getSkillLevel", () => {
	it("labels superhuman accuracy correctly", () => {
		const level = getSkillLevel(96, "chess");
		expect(level.label).toBe("Superhuman");
	});

	it("labels pro+ accuracy correctly", () => {
		const level = getSkillLevel(91, "chess");
		expect(level.label).toBe("Pro+");
	});

	it("labels club accuracy correctly", () => {
		const level = getSkillLevel(55, "chess");
		expect(level.label).toBe("Club");
	});

	it("labels casual+ accuracy correctly", () => {
		const level = getSkillLevel(45, "chess");
		expect(level.label).toBe("Casual+");
	});

	it("labels beginner correctly", () => {
		const level = getSkillLevel(25, "chess");
		expect(level.label).toBe("Beginner");
	});

	it("uses ACPL-based tiers when provided", () => {
		expect(getSkillLevel(50, "chess", 20).label).toBe("Superhuman");
		expect(getSkillLevel(50, "chess", 100).label).toBe("Club+");
		expect(getSkillLevel(50, "chess", 170).label).toBe("Club");
		expect(getSkillLevel(50, "chess", 200).label).toBe("Casual+");
		expect(getSkillLevel(50, "chess", 400).label).toBe("Beginner");
	});

	it("uses Go ranks for Go games", () => {
		// accuracy 80 → Go maxAccuracy: Pro=82 (no), Club+=70 (yes)
		const level = getSkillLevel(80, "go");
		expect(level.label).toBe("Club+");
		expect(level.rating).toContain("kyu");
	});

	it("Go ACPL-based tiers (tightened from sim data)", () => {
		expect(getSkillLevel(50, "go", 10).label).toBe("Superhuman");
		expect(getSkillLevel(50, "go", 25).label).toBe("Pro+");
		expect(getSkillLevel(50, "go", 50).label).toBe("Pro");
		expect(getSkillLevel(50, "go", 90).label).toBe("Club+");
		expect(getSkillLevel(50, "go", 140).label).toBe("Club");
		expect(getSkillLevel(50, "go", 200).label).toBe("Casual+");
		expect(getSkillLevel(50, "go", 280).label).toBe("Casual");
		expect(getSkillLevel(50, "go", 500).label).toBe("Beginner");
	});

	it("Janggi uses separate ACPL thresholds", () => {
		// Janggi has higher ACPL thresholds than chess
		expect(getSkillLevel(50, "janggi", 28).label).toBe("Superhuman");
		expect(getSkillLevel(50, "janggi", 80).label).toBe("Pro");
		expect(getSkillLevel(50, "janggi", 200).label).toBe("Club");
		// Same ACPL=200 in chess would be Casual+, but in janggi it's still Club
		expect(getSkillLevel(50, "chess", 200).label).toBe("Casual+");
	});

	// Simulate a real chess game: GM Carlsen-like accuracy
	it("real game simulation: strong player", () => {
		const evals = [
			0, 15, 20, 10, 25, 18, 30, 22, 35, 28, 40, 32, 45, 38, 50, 42, 55, 48, 60, 52, 65, 58, 70, 62,
			75, 68, 80, 72, 85, 78,
		];
		const result = gameAccuracy(evals, "white", 4);
		const level = getSkillLevel(result.accuracy, "chess");
		expect(result.accuracy).toBeGreaterThan(80);
		expect(["Superhuman", "Pro+", "Pro"]).toContain(level.label);
	});

	// Simulate a weak player who blunders repeatedly
	it("real game simulation: weak player", () => {
		const evals = [
			0, -200, -100, -400, -50, -500, 0, -600, 50, -700, 100, -800, 50, -900, 0, -1000, 50, -1200,
			0, -1400, 50, -1600, 0, -1800,
		];
		const result = gameAccuracy(evals, "white", 0);
		const level = getSkillLevel(result.accuracy, "chess");
		expect(result.accuracy).toBeLessThan(50);
		expect(["Beginner", "Casual", "Casual+"]).toContain(level.label);
	});
});

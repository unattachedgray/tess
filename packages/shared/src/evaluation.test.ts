import { describe, expect, it } from "vitest";
import { gameAccuracy, getSkillLevel, moveAccuracy, winPercent } from "./evaluation.js";

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
	it("labels engine-level accuracy correctly", () => {
		const level = getSkillLevel(96, "chess");
		expect(level.label).toBe("Engine");
	});

	it("labels grandmaster accuracy correctly", () => {
		const level = getSkillLevel(91, "chess");
		expect(level.label).toBe("Grandmaster");
	});

	it("labels intermediate correctly", () => {
		const level = getSkillLevel(55, "chess");
		expect(level.label).toBe("Intermediate");
	});

	it("labels beginner correctly", () => {
		const level = getSkillLevel(25, "chess");
		expect(level.label).toBe("Beginner");
	});

	it("uses Go ranks for Go games", () => {
		const level = getSkillLevel(80, "go");
		expect(level.label).toBe("Dan");
		expect(level.rating).toContain("dan");
	});

	// Simulate a real chess game: GM Carlsen-like accuracy
	it("real game simulation: strong player", () => {
		// Evals from a well-played game (small fluctuations)
		const evals = [
			0, 15, 20, 10, 25, 18, 30, 22, 35, 28, 40, 32, 45, 38, 50, 42, 55, 48, 60, 52, 65, 58, 70, 62,
			75, 68, 80, 72, 85, 78,
		];
		const result = gameAccuracy(evals, "white", 4);
		const level = getSkillLevel(result.accuracy, "chess");
		expect(result.accuracy).toBeGreaterThan(80);
		expect(["Grandmaster", "Master", "Engine"]).toContain(level.label);
	});

	// Simulate a weak player who blunders repeatedly
	it("real game simulation: weak player", () => {
		// White loses ~200cp every move
		const evals = [
			0, -200, -100, -400, -50, -500, 0, -600, 50, -700, 100, -800, 50, -900, 0, -1000, 50, -1200,
			0, -1400, 50, -1600, 0, -1800,
		];
		const result = gameAccuracy(evals, "white", 0);
		const level = getSkillLevel(result.accuracy, "chess");
		expect(result.accuracy).toBeLessThan(50);
		expect(["Beginner", "Casual"]).toContain(level.label);
	});
});

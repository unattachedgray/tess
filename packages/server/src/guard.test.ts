/**
 * Guard tests.
 *
 * These assert INVARIANTS, not the current constants. An earlier version of
 * this file hardcoded "12 connections are accepted"; lowering the default to 3
 * then failed a test that was measuring nothing but the literal. What actually
 * matters is that the cap holds, that a refusal is per-address rather than
 * global, and that a slot comes back when a socket closes.
 *
 * Each limit is set through the environment here so the test states its own
 * preconditions instead of inheriting whatever the defaults happen to be.
 */
import { beforeAll, describe, expect, it } from "vitest";

const CONNS_TOTAL = 8;
const CONNS_PER_IP = 3;
const AI_DAY = 20;

process.env.TESS_MAX_CONNS = String(CONNS_TOTAL);
process.env.TESS_MAX_CONNS_PER_IP = String(CONNS_PER_IP);
process.env.TESS_AI_GLOBAL_DAY = String(AI_DAY);
process.env.TESS_AI_PER_IP_HOUR = "5";

let guard: typeof import("./guard.js");

beforeAll(async () => {
	guard = await import("./guard.js");
});

describe("clientIp", () => {
	it("normalises IPv4-mapped IPv6 so one host is not counted as two", () => {
		expect(guard.clientIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
	});

	it("does not crash on a missing address", () => {
		expect(guard.clientIp(undefined)).toBe("unknown");
	});

	it("uses the forwarded address when the peer is loopback (the tunnel case)", () => {
		// tess.unattached.me is a cloudflared tunnel, so every public visitor's
		// socket address is 127.0.0.1. Without this the whole internet shares
		// one bucket and three strangers lock each other out.
		expect(guard.clientIp("127.0.0.1", { "cf-connecting-ip": "203.0.113.9" })).toBe(
			"203.0.113.9",
		);
		expect(guard.clientIp("::1", { "x-forwarded-for": "203.0.113.9, 10.0.0.1" })).toBe(
			"203.0.113.9",
		);
	});

	it("IGNORES a forwarded header from a non-loopback peer", () => {
		// Otherwise a direct caller mints itself a fresh bucket per request and
		// every limit here is decorative.
		expect(guard.clientIp("198.51.100.7", { "cf-connecting-ip": "203.0.113.9" })).toBe(
			"198.51.100.7",
		);
	});
});

describe("connection caps", () => {
	it("refuses past the per-address cap and frees the slot on close", () => {
		const ip = "203.0.113.20";
		for (let i = 0; i < CONNS_PER_IP; i++) {
			expect(guard.acceptConnection(ip)).toBe(true);
		}
		expect(guard.acceptConnection(ip)).toBe(false);

		guard.releaseConnection(ip);
		expect(guard.acceptConnection(ip)).toBe(true); // slot came back
		for (let i = 0; i < CONNS_PER_IP; i++) guard.releaseConnection(ip);
	});

	it("does not let one address consume another's budget", () => {
		const abuser = "203.0.113.21";
		while (guard.acceptConnection(abuser)) {
			/* fill the abuser's share */
		}
		expect(guard.acceptConnection("198.51.100.30")).toBe(true);
		guard.releaseConnection("198.51.100.30");
		for (let i = 0; i < CONNS_PER_IP; i++) guard.releaseConnection(abuser);
	});

	it("holds a global cap even when every request is a different address", () => {
		const opened: string[] = [];
		for (let i = 0; i < CONNS_TOTAL + 5; i++) {
			const ip = `10.1.0.${i}`;
			if (guard.acceptConnection(ip)) opened.push(ip);
		}
		expect(opened.length).toBe(CONNS_TOTAL);
		for (const ip of opened) guard.releaseConnection(ip);
	});

	it("keeps the per-address cap below the global one", () => {
		// If per-IP >= global, a single caller can occupy every slot and the
		// global cap stops constraining the one party it exists to constrain.
		expect(CONNS_PER_IP).toBeLessThan(CONNS_TOTAL);
		expect(guard.guardStats().connectionCap).toBe(CONNS_TOTAL);
	});
});

describe("message rate", () => {
	it("allows a burst then refuses, per address", () => {
		const ip = "203.0.113.40";
		let allowed = 0;
		while (guard.allowMessage(ip) && allowed < 1000) allowed++;
		expect(allowed).toBeGreaterThan(0);
		expect(guard.allowMessage(ip)).toBe(false);
		expect(guard.allowMessage("198.51.100.41")).toBe(true); // separate bucket
	});
});

describe("AI spend cap", () => {
	it("counts calls that carry no address", () => {
		// TRAP — the call sites in ai.ts do not know the caller's address, so
		// they invoke allowAiCall() with no argument. An early return for that
		// case skipped the increment entirely: the cap compiled, read correctly,
		// and bounded nothing.
		let n = 0;
		while (guard.allowAiCall() && n < AI_DAY * 3) n++;
		expect(n).toBe(AI_DAY);
		expect(guard.allowAiCall()).toBe(false);
		expect(guard.guardStats().aiToday).toBe(AI_DAY);
	});
});

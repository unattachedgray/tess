/**
 * Abuse guards for a PUBLIC server.
 *
 * Tess is meant to be reachable by anyone, multiplayer included, so the goal
 * here is not to gate access — it is to make anonymous access survivable.
 * Three things are finite and worth protecting:
 *
 *   1. sockets      — an open bind means anyone can hold connections
 *   2. CPU          — the UCI/KataGo pool is bounded, but the queue in front
 *                     of it is not, so a flood turns into unbounded latency
 *   3. money        — AI coaching spends the owner's Gemini quota per call,
 *                     and nothing else in the process costs real currency
 *
 * ws.ts already rate-limits messages PER CONNECTION (30/s). That limit is
 * bypassed simply by opening more sockets, so the caps here are per ADDRESS
 * and compose with it rather than replacing it.
 *
 * Deliberately IP-keyed and in-memory. A shared NAT (a school, a café, a
 * university) shares a bucket, which is why the per-IP limits are generous
 * rather than tight: the aim is to stop one host monopolising the server, not
 * to police individual players. Anything stricter needs accounts, and accounts
 * are exactly what a casual public game should not require.
 */

import { createLogger } from "./logger.js";

const log = createLogger("guard");

/** Total sockets the server will hold at once. The binding resource is NOT
 *  memory or sockets — it is the engine pool (ENGINE_POOL_SIZE, default 2) and
 *  MAX_CONCURRENT=2 for AI coaching. Ten players is comfortable for a box with
 *  two engine slots; a hundred is not, because every analysis request past the
 *  pool queues behind a 30s checkout timeout. */
const MAX_CONNS_TOTAL = Number(process.env.TESS_MAX_CONNS ?? 10);

/** Sockets one address may hold at once. This MUST stay well below the global
 *  cap. If per-IP >= global, one address can occupy every slot and the global
 *  cap stops meaning anything against the one caller it exists to stop. */
const MAX_CONNS_PER_IP = Number(process.env.TESS_MAX_CONNS_PER_IP ?? 3);

/** Client→server messages per second, averaged over a short window. Real play
 *  is a few messages a minute; even frantic clicking stays far below this. */
const MSG_PER_SEC = Number(process.env.TESS_MSG_PER_SEC ?? 20);
const MSG_BURST = Number(process.env.TESS_MSG_BURST ?? 60);

/** Largest client frame. The biggest legitimate message is a settings update;
 *  nothing a player sends is near this. Enforced by ws itself so an oversized
 *  frame is dropped before it is buffered. */
export const MAX_PAYLOAD_BYTES = Number(process.env.TESS_MAX_PAYLOAD ?? 64 * 1024);

/** AI coaching calls. Per-IP protects against one abuser; the daily global cap
 *  is the one that actually bounds the bill, because IPs are cheap and a
 *  distributed flood would otherwise walk straight past a per-IP limit. */
const AI_PER_IP_HOUR = Number(process.env.TESS_AI_PER_IP_HOUR ?? 120);
const AI_GLOBAL_DAY = Number(process.env.TESS_AI_GLOBAL_DAY ?? 5000);

interface Bucket {
	tokens: number;
	last: number;
}

const conns = new Map<string, number>();
const msgBuckets = new Map<string, Bucket>();
const aiHour = new Map<string, { n: number; hour: number }>();
let aiDay = { n: 0, day: -1 };

function normalise(raw: string): string {
	const s = raw.trim();
	return s.startsWith("::ffff:") ? s.slice(7) : s;
}

function isLoopback(ip: string): boolean {
	return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("127.");
}

/**
 * The address to hold accountable for a socket.
 *
 * TRAP — tess.unattached.me is a cloudflared tunnel, and a reverse tunnel
 * connects FROM loopback. So `socket.remoteAddress` is 127.0.0.1 for every
 * visitor on the public internet. Keying the caps on it would put the whole
 * internet in ONE bucket: three strangers would lock each other out while a
 * real flood still only ever counted as one address. This is the same
 * composition error that exposed the weft dashboard.
 *
 * RULE — trust a forwarded header ONLY when the socket peer is loopback. A
 * direct caller (LAN, or the open bind) cannot reach that branch, so it cannot
 * spoof its way into a fresh bucket. The only loopback peers are cloudflared
 * and the owner, and the owner spoofing themselves costs nobody anything.
 *
 * IPv4-mapped IPv6 (`::ffff:1.2.3.4`) is normalised to its IPv4 form —
 * otherwise one host counts as two and every limit silently doubles.
 */
export function clientIp(
	raw: string | undefined,
	headers?: Record<string, string | string[] | undefined>,
): string {
	const peer = raw ? normalise(raw) : "unknown";
	if (!headers || !isLoopback(peer)) return peer;

	const pick = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";
	const cf = pick(headers["cf-connecting-ip"]).trim();
	if (cf) return normalise(cf);
	const xff = pick(headers["x-forwarded-for"]).split(",")[0]?.trim() ?? "";
	if (xff) return normalise(xff);
	return peer;
}

/** True when this address may open another socket. Checks the global cap
 *  first: it is the one that bounds CPU, and it must hold even when every
 *  request arrives from a different address. */
export function acceptConnection(ip: string): boolean {
	const total = [...conns.values()].reduce((a, b) => a + b, 0);
	if (total >= MAX_CONNS_TOTAL) {
		log.warn("connection refused: server full", { ip, total, cap: MAX_CONNS_TOTAL });
		return false;
	}
	const n = conns.get(ip) ?? 0;
	if (n >= MAX_CONNS_PER_IP) {
		log.warn("connection refused: per-ip cap", { ip, open: n, cap: MAX_CONNS_PER_IP });
		return false;
	}
	conns.set(ip, n + 1);
	return true;
}

export function releaseConnection(ip: string): void {
	const n = (conns.get(ip) ?? 1) - 1;
	if (n <= 0) conns.delete(ip);
	else conns.set(ip, n);
}

/**
 * Token bucket per address. Returns false when the caller is over budget.
 *
 * A bucket refills continuously rather than resetting on a boundary, so a
 * client cannot save up a whole window and spend it in one burst at the tick.
 */
export function allowMessage(ip: string): boolean {
	const now = Date.now();
	const b = msgBuckets.get(ip) ?? { tokens: MSG_BURST, last: now };
	b.tokens = Math.min(MSG_BURST, b.tokens + ((now - b.last) / 1000) * MSG_PER_SEC);
	b.last = now;
	if (b.tokens < 1) {
		msgBuckets.set(ip, b);
		return false;
	}
	b.tokens -= 1;
	msgBuckets.set(ip, b);
	return true;
}

/**
 * Gate one AI coaching call. Checks the global daily cap FIRST: when the bill
 * is the thing being protected, the global number is the one that must hold
 * even if every request arrives from a different address.
 */
export function allowAiCall(ip?: string): boolean {
	const now = new Date();
	const day = Math.floor(now.getTime() / 86_400_000);
	if (aiDay.day !== day) aiDay = { n: 0, day };
	if (aiDay.n >= AI_GLOBAL_DAY) {
		log.warn("ai call refused: global daily cap", { cap: AI_GLOBAL_DAY });
		return false;
	}

	// TRAP — count the call BEFORE the optional per-IP branch below. An earlier
	// version returned early for the no-ip case and skipped the increment, so
	// the global counter never rose and the cap never tripped. That is the exact
	// path ai.ts uses, i.e. the spend cap silently did nothing. Caught by test,
	// not by review: it compiled and read correctly.
	aiDay.n += 1;

	// The per-IP layer is optional: the AI call sites (gameRoom, postGameEval)
	// sit well below the socket and do not know the address. Rather than thread
	// it through every layer they enforce the GLOBAL cap — the one that bounds
	// the bill — while a single address's share is already limited by the
	// connection cap above.
	if (!ip) return true;

	const hour = Math.floor(now.getTime() / 3_600_000);
	const rec = aiHour.get(ip);
	const cur = rec && rec.hour === hour ? rec : { n: 0, hour };
	if (cur.n >= AI_PER_IP_HOUR) {
		log.warn("ai call refused: per-ip hourly cap", { ip, cap: AI_PER_IP_HOUR });
		aiHour.set(ip, cur);
		aiDay.n -= 1; // refused, so it must not consume the global budget
		return false;
	}

	cur.n += 1;
	aiHour.set(ip, cur);
	return true;
}

/** Drop stale buckets so a long-lived public server does not accumulate one
 *  map entry per address that ever connected. */
export function sweep(): void {
	const now = Date.now();
	for (const [ip, b] of msgBuckets) {
		if (now - b.last > 600_000) msgBuckets.delete(ip);
	}
	const hour = Math.floor(now / 3_600_000);
	for (const [ip, r] of aiHour) {
		if (r.hour !== hour) aiHour.delete(ip);
	}
}

/** Operational visibility — surfaced by GET /api/admin, so the caps in
 *  force can be read off a running server rather than inferred from this
 *  file. A pm2 env block is only re-read by `startOrReload`, so the two
 *  can disagree with nothing to show it. */
export function guardStats() {
	return {
		ips: conns.size,
		connections: [...conns.values()].reduce((a, b) => a + b, 0),
		connectionCap: MAX_CONNS_TOTAL,
		aiToday: aiDay.n,
		aiDailyCap: AI_GLOBAL_DAY,
	};
}

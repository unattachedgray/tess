import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getGame, getRecentGames, getUserStats, upsertUser } from "./db.js";
import type { FederationService } from "./federation.js";
import { clientIp, guardStats } from "./guard.js";
import { createLogger } from "./logger.js";
import type { SessionManager } from "./session.js";

/** Simple per-IP rate limiter — returns true if request should be blocked */
function rateLimit(
	store: Map<string, { count: number; reset: number }>,
	ip: string,
	maxPerMinute: number,
): boolean {
	const now = Date.now();
	const entry = store.get(ip);
	if (!entry || now > entry.reset) {
		store.set(ip, { count: 1, reset: now + 60_000 });
		return false;
	}
	entry.count++;
	return entry.count > maxPerMinute;
}

const log = createLogger("http");

/**
 * The address to hold accountable for an HTTP request.
 *
 * RULE — one implementation, shared with the WebSocket layer. The old code read
 * x-forwarded-for directly and fell back to "unknown", so every direct caller
 * shared one rate-limit bucket while an attacker rotated the header for an
 * unlimited supply of fresh ones. Both properties are backwards.
 */
function reqIp(c: { env?: unknown; req: { header: (n: string) => string | undefined } }): string {
	const peer = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
		?.incoming?.socket?.remoteAddress;
	return clientIp(peer, {
		"cf-connecting-ip": c.req.header("cf-connecting-ip"),
		"x-forwarded-for": c.req.header("x-forwarded-for"),
	});
}

export function createApp(sessionManager: SessionManager, federation?: FederationService): Hono {
	const apiRateLimits = new Map<string, { count: number; reset: number }>();
	const app = new Hono();

	// CORS: allow same-origin in production, permissive in development
	const isDev = process.env.NODE_ENV !== "production";
	// TRAP — the old policy reflected ANY origin back with credentials:true.
	// That is strictly worse than "*", because reflecting is legal with
	// credentials while "*" is not: any page on the internet could drive this
	// API as the visitor. The SPA is served from this same origin and needs no
	// CORS at all; the allowlist exists only for a separately-hosted client.
	const allowedOrigins = (process.env.TESS_ALLOWED_ORIGINS ?? "https://tess.unattached.me")
		.split(",")
		.map((o) => o.trim())
		.filter(Boolean);
	app.use(
		"*",
		cors({
			origin: isDev ? "*" : (origin) => (allowedOrigins.includes(origin) ? origin : null),
			credentials: true,
		}),
	);

	// --- Admin API ---

	app.get("/api/health", (c) => {
		return c.json({
			status: "ok",
			uptime: Math.round(process.uptime()),
			activeGames: sessionManager.activeRoomCount,
			memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
			discovery: process.env.TESS_DISCOVERY !== "off",
			federation: federation?.getStats() ?? null,
		});
	});

	app.get("/api/admin", (c) => {
		// Redact sensitive internals — only expose what's useful for debugging
		return c.json({
			uptime: Math.round(process.uptime()),
			activeGames: sessionManager.activeRoomCount,
			memory: {
				heapMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
			},
			// The live abuse-guard numbers. Here so the caps can be READ off a
			// running server instead of remembered or inferred from the source:
			// pm2 env blocks are only re-read by `startOrReload`, so the values
			// compiled into the code are not necessarily the ones in force.
			guards: guardStats(),
		});
	});

	// --- Game History API ---

	app.get("/api/games", (c) => {
		// WHY — unclamped, ?limit=1e9 dumps the whole games table (every move
		// list, every user id) and ?limit=abc is NaN, which reached SQLite and
		// returned a 500.
		const raw = Number(c.req.query("limit") ?? "20");
		const limit = Math.min(Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : 20), 100);
		const gameType = c.req.query("type");
		const userId = c.req.query("user");
		const games = getRecentGames(limit, gameType, userId);
		return c.json({ games });
	});

	app.get("/api/games/:id", (c) => {
		const game = getGame(c.req.param("id"));
		if (!game) return c.json({ error: "Game not found" }, 404);
		return c.json({ game });
	});

	// Export game in standard format
	app.get("/api/games/:id/export", (c) => {
		const game = getGame(c.req.param("id")) as Record<string, unknown> | undefined;
		if (!game) return c.json({ error: "Game not found" }, 404);

		const gameType = game.game_type as string;
		const format = c.req.query("format") ?? (gameType === "go" ? "sgf" : "pgn");

		if (format === "pgn" && game.pgn) {
			c.header("Content-Type", "application/x-chess-pgn");
			c.header("Content-Disposition", `attachment; filename="${game.id}.pgn"`);
			return c.text(game.pgn as string);
		}

		if (format === "sgf" && gameType === "go") {
			const moves = JSON.parse(game.moves as string) as { uci: string }[];
			const sgf = generateSgf(moves, game);
			c.header("Content-Type", "application/x-go-sgf");
			c.header("Content-Disposition", `attachment; filename="${game.id}.sgf"`);
			return c.text(sgf);
		}

		// Fallback: JSON
		return c.json({ game });
	});

	// --- User API ---

	app.get("/api/users/:id/stats", (c) => {
		const stats = getUserStats(c.req.param("id"));
		return c.json(stats);
	});

	app.post("/api/users", async (c) => {
		const ip = reqIp(c);
		if (rateLimit(apiRateLimits, `user:${ip}`, 20)) {
			return c.json({ error: "Too many requests" }, 429);
		}
		const body = await c.req.json().catch(() => null);
		const okStr = (v: unknown, max: number) =>
			typeof v === "string" && v.length > 0 && v.length <= max;
		if (!body || !okStr(body.id, 64) || !okStr(body.displayName, 64)) {
			return c.json({ error: "id and displayName required (strings, <=64 chars)" }, 400);
		}
		if (body.browserKey !== undefined && !okStr(body.browserKey, 128)) {
			return c.json({ error: "browserKey must be a string (<=128 chars)" }, 400);
		}
		upsertUser(body.id, body.displayName, body.browserKey);
		return c.json({ ok: true });
	});

	// ── Tess Open Game API (v1) ──
	// Compatible in spirit with Lichess Board API and OGS API.
	// Designed to be the standard for Janggi online play.

	app.get("/api/v1/challenges", (c) => {
		// Public endpoint: list open challenges on this server
		// Rate limit: 60 requests/minute per IP
		return c.json({
			challenges: [], // TODO: wire to lobby
			server: {
				name: process.env.TESS_SERVER_NAME ?? "Tess",
				version: "1.0.0",
				games: ["chess", "go", "janggi"],
			},
		});
	});

	// ── Federation API ──
	// Guarded by TESS_DISCOVERY env var — set to "off" to disable completely

	let _discoveryOverride: boolean | null = null;
	const discoveryEnabled = () => _discoveryOverride ?? process.env.TESS_DISCOVERY !== "off";

	app.post("/api/federation/toggle", async (c) => {
		// TRAP — this route starts Hyperswarm on the public DHT and opens a
		// UPnP/NAT-PMP mapping for this port on the router. It is a
		// network-boundary change, so it must never be reachable anonymously.
		//
		// The old check read x-forwarded-for and had two bypasses: no header at
		// all fell through to the allowlisted default, and a spoofed
		// "127.0.0.1" passed outright. Both were verified working.
		//
		// RULE — decide by IDENTITY, not locality. Locality is meaningless here:
		// tess.unattached.me is a cloudflared tunnel, so every visitor on the
		// internet arrives from 127.0.0.1. A socket-based "local only" check
		// would admit all of them. Fails closed when the token is unset.
		const adminToken = process.env.TESS_ADMIN_TOKEN ?? "";
		const presented = c.req.header("x-tess-admin") ?? "";
		if (!adminToken || presented !== adminToken) {
			log.warn("federation toggle refused", { ip: reqIp(c), hasToken: !!adminToken });
			return c.json({ error: "Forbidden" }, 403);
		}
		const body = await c.req.json();
		if (typeof body.enabled !== "boolean") {
			return c.json({ error: "enabled (boolean) required" }, 400);
		}
		_discoveryOverride = body.enabled;
		if (!body.enabled && federation) {
			federation.destroy();
		} else if (body.enabled && federation) {
			federation.start().catch(() => {});
		}
		return c.json({ discovery: body.enabled });
	});

	app.get("/api/federation/status", (c) => {
		return c.json({
			enabled: discoveryEnabled(),
			stats: federation?.getStats() ?? null,
		});
	});

	app.post("/api/federation/peers", async (c) => {
		if (!discoveryEnabled()) {
			return c.json({ error: "Federation disabled on this server" }, 403);
		}
		const ip = reqIp(c);
		if (rateLimit(apiRateLimits, `peer:${ip}`, 10)) {
			return c.json({ error: "Too many requests" }, 429);
		}
		const body = await c.req.json();
		if (!body.url || typeof body.url !== "string") {
			return c.json({ error: "url required" }, 400);
		}
		try {
			new URL(body.url);
		} catch {
			return c.json({ error: "Invalid URL" }, 400);
		}
		// TODO: Store in peers table + validate with heartbeat
		return c.json({ ok: true, message: "Peer registered" });
	});

	app.get("/api/federation/peers", (c) => {
		if (!discoveryEnabled()) {
			return c.json({ error: "Federation disabled on this server" }, 403);
		}
		// TODO: Read from peers table
		return c.json({ peers: [] });
	});

	app.post("/api/federation/heartbeat", (c) => {
		if (!discoveryEnabled()) {
			return c.json({ error: "Federation disabled on this server" }, 403);
		}
		return c.json({
			name: process.env.TESS_SERVER_NAME ?? "Tess",
			version: "1.0.0",
			players: sessionManager.activeRoomCount,
			games: ["chess", "go", "janggi"],
			discovery: true,
		});
	});

	app.get("/api/federation/challenges", (c) => {
		if (!discoveryEnabled()) {
			return c.json({ error: "Federation disabled on this server" }, 403);
		}
		// TODO: Read from lobby
		return c.json({ challenges: [] });
	});

	// ── Join routes (serve SPA for game code URLs) ──
	app.get("/join/:code", serveStatic({ root: "../../packages/client/dist", path: "index.html" }));
	app.get("/watch/:code", serveStatic({ root: "../../packages/client/dist", path: "index.html" }));

	// Serve static files in production
	app.use("/*", serveStatic({ root: "../../packages/client/dist" }));
	app.get("*", serveStatic({ root: "../../packages/client/dist", path: "index.html" }));

	return app;
}

/** Generate SGF (Smart Game Format) for Go games */
function generateSgf(moves: { uci: string }[], game: Record<string, unknown>): string {
	const size = (game.board_size as number) ?? 19;
	const cols = "abcdefghijklmnopqrs";
	const date = (game.created_at as string)?.slice(0, 10) ?? "";

	let sgf = `(;GM[1]FF[4]SZ[${size}]DT[${date}]AP[Tess]`;
	if (game.result === "black") sgf += "RE[B+R]";
	else if (game.result === "white") sgf += "RE[W+R]";
	else if (game.result === "draw") sgf += "RE[0]";

	const gtpCols = "ABCDEFGHJKLMNOPQRST";
	for (let i = 0; i < moves.length; i++) {
		const coord = moves[i].uci;
		if (coord === "PASS") {
			sgf += i % 2 === 0 ? ";B[]" : ";W[]";
			continue;
		}
		const colIdx = gtpCols.indexOf(coord[0]?.toUpperCase());
		const row = Number.parseInt(coord.slice(1), 10);
		if (colIdx >= 0 && row > 0 && row <= size) {
			const color = i % 2 === 0 ? "B" : "W";
			sgf += `;${color}[${cols[colIdx]}${cols[size - row]}]`;
		}
	}

	return `${sgf})`;
}

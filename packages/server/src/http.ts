import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getGame, getRecentGames, getUserStats, upsertUser } from "./db.js";
import type { SessionManager } from "./session.js";

export function createApp(sessionManager: SessionManager): Hono {
	const app = new Hono();

	app.use("*", cors());

	// --- Admin API ---

	app.get("/api/health", (c) => {
		return c.json({
			status: "ok",
			uptime: Math.round(process.uptime()),
			activeGames: sessionManager.activeRoomCount,
			memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
		});
	});

	app.get("/api/admin", (c) => {
		return c.json({
			uptime: Math.round(process.uptime()),
			activeGames: sessionManager.activeRoomCount,
			memory: {
				heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
				heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
				rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
			},
			pid: process.pid,
			nodeVersion: process.version,
		});
	});

	// --- Game History API ---

	app.get("/api/games", (c) => {
		const limit = Number(c.req.query("limit") ?? "20");
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

	// --- User API ---

	app.get("/api/users/:id/stats", (c) => {
		const stats = getUserStats(c.req.param("id"));
		return c.json(stats);
	});

	app.post("/api/users", async (c) => {
		const body = await c.req.json();
		if (!body.id || !body.displayName) {
			return c.json({ error: "id and displayName required" }, 400);
		}
		upsertUser(body.id, body.displayName, body.browserKey);
		return c.json({ ok: true });
	});

	// Serve static files in production
	app.use("/*", serveStatic({ root: "../../packages/client/dist" }));

	// SPA fallback
	app.get("*", serveStatic({ root: "../../packages/client/dist", path: "index.html" }));

	return app;
}

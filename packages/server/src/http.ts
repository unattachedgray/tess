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
		const body = await c.req.json();
		if (!body.id || !body.displayName) {
			return c.json({ error: "id and displayName required" }, 400);
		}
		upsertUser(body.id, body.displayName, body.browserKey);
		return c.json({ ok: true });
	});

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

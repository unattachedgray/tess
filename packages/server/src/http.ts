import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SessionManager } from "./session.js";

export function createApp(sessionManager: SessionManager): Hono {
	const app = new Hono();

	app.use("*", cors());

	app.get("/api/health", (c) => {
		return c.json({
			status: "ok",
			uptime: process.uptime(),
			activeGames: sessionManager.activeRoomCount,
		});
	});

	// Serve static files in production
	app.use("/*", serveStatic({ root: "../../packages/client/dist" }));

	// SPA fallback
	app.get("*", serveStatic({ root: "../../packages/client/dist", path: "index.html" }));

	return app;
}

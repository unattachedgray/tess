import { serve } from "@hono/node-server";
import { resolveEnginePath, resolveNnuePath } from "./engine/resolve.js";
import { UciPool } from "./engine/uciPool.js";
import { createApp } from "./http.js";
import { createLogger } from "./logger.js";
import { SessionManager } from "./session.js";
import { createWsServer } from "./ws.js";

const log = createLogger("server");
const PORT = Number.parseInt(process.env.PORT ?? "8082", 10);

async function main() {
	const stockfishPath = resolveEnginePath();
	log.info("engine path resolved", { stockfish: stockfishPath });

	const nnuePath = resolveNnuePath();
	const opts: Record<string, string> = {};
	if (nnuePath) opts.EvalFile = nnuePath;

	const uciPool = new UciPool(stockfishPath, 2, opts);
	log.info("initializing engine pool...");
	await uciPool.init();
	log.info("engine pool ready");

	const sessionManager = new SessionManager(uciPool);
	const app = createApp(sessionManager);

	const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
		log.info(`server listening on port ${info.port}`);
	});

	createWsServer(server, sessionManager);

	const shutdown = () => {
		log.info("shutting down...");
		uciPool.shutdown();
		server.close();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	log.error("fatal error", { error: err.message, stack: err.stack });
	process.exit(1);
});

import { serve } from "@hono/node-server";
import { KataGoAdapter } from "./engine/katago.js";
import {
	resolveEnginePath,
	resolveKataGoConfig,
	resolveKataGoPath,
	resolveNnuePath,
} from "./engine/resolve.js";
import { UciPool } from "./engine/uciPool.js";
import { createApp } from "./http.js";
import { createLogger } from "./logger.js";
import { SessionManager } from "./session.js";
import { createWsServer } from "./ws.js";

const log = createLogger("server");
const PORT = Number.parseInt(process.env.PORT ?? "8082", 10);

async function main() {
	// Initialize Fairy-Stockfish
	const stockfishPath = resolveEnginePath();
	log.info("Stockfish path resolved", { stockfish: stockfishPath });

	const nnuePath = resolveNnuePath();
	const opts: Record<string, string> = {};
	if (nnuePath) opts.EvalFile = nnuePath;

	const uciPool = new UciPool(stockfishPath, 2, opts);
	log.info("initializing Stockfish pool...");
	await uciPool.init();
	log.info("Stockfish pool ready");

	// Initialize KataGo (optional — Go won't work without it)
	let kataGo: KataGoAdapter | null = null;
	const kataGoPath = resolveKataGoPath();
	const kataGoConfig = resolveKataGoConfig();

	if (kataGoPath && kataGoConfig) {
		try {
			kataGo = new KataGoAdapter(kataGoPath, kataGoConfig.config, kataGoConfig.model, {
				numSearchThreads: "4",
				numAnalysisThreads: "2",
			});
			log.info("initializing KataGo...");
			await kataGo.init();
			log.info("KataGo ready");
		} catch (err) {
			log.warn("KataGo init failed, Go will not be available", {
				error: (err as Error).message,
			});
			kataGo = null;
		}
	} else {
		log.warn("KataGo not found, Go will not be available");
	}

	const sessionManager = new SessionManager(uciPool, kataGo);
	const app = createApp(sessionManager);

	const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
		log.info(`server listening on port ${info.port}`);
	});

	createWsServer(server, sessionManager);

	const shutdown = () => {
		log.info("shutting down...");
		uciPool.shutdown();
		kataGo?.shutdown();
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

import { serve } from "@hono/node-server";
import { KataGoAdapter } from "./engine/katago.js";
import {
	resolveEnginePath,
	resolveJanggiEnginePath,
	resolveJanggiNnuePath,
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
	// Initialize database
	const { initDb } = await import("./db.js");
	initDb();

	// Chess engine pool (Fairy-Stockfish standard)
	const stockfishPath = resolveEnginePath();
	const nnuePath = resolveNnuePath();
	const chessOpts: Record<string, string> = {};
	if (nnuePath) chessOpts.EvalFile = nnuePath;

	const chessPool = new UciPool(stockfishPath, 2, chessOpts);
	log.info("initializing Chess engine pool...");
	await chessPool.init();
	log.info("Chess engine pool ready");

	// Janggi engine pool (Fairy-Stockfish largeboard)
	let janggiPool: UciPool | null = null;
	const janggiPath = resolveJanggiEnginePath();
	if (janggiPath) {
		const janggiOpts: Record<string, string> = {
			UCI_Variant: "janggi",
			"Use NNUE": "false",
		};
		const janggiNnue = resolveJanggiNnuePath();
		if (janggiNnue) janggiOpts.EvalFile = janggiNnue;

		janggiPool = new UciPool(janggiPath, 2, janggiOpts);
		log.info("initializing Janggi engine pool...");
		try {
			await janggiPool.init();
			log.info("Janggi engine pool ready");
		} catch (err) {
			log.warn("Janggi engine init failed", { error: (err as Error).message });
			janggiPool = null;
		}
	} else {
		log.warn("Janggi largeboard engine not found, Janggi will use standard Stockfish");
	}

	// KataGo (Go engine)
	let kataGo: KataGoAdapter | null = null;
	const kataGoPath = resolveKataGoPath();
	const kataGoConfig = resolveKataGoConfig();

	if (kataGoPath && kataGoConfig) {
		try {
			const isGpu = kataGoPath.includes("cuda");
			kataGo = new KataGoAdapter(kataGoPath, kataGoConfig.config, kataGoConfig.model, {
				numSearchThreads: isGpu ? "12" : "4",
				numAnalysisThreads: "2",
				...(isGpu ? { nnMaxBatchSize: "64", nnCacheSizePowerOfTwo: "21" } : {}),
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
	}

	const sessionManager = new SessionManager(chessPool, janggiPool, kataGo);
	const app = createApp(sessionManager);

	const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
		log.info(`server listening on port ${info.port}`);
	});

	createWsServer(server, sessionManager);

	const shutdown = () => {
		log.info("shutting down...");
		chessPool.shutdown();
		janggiPool?.shutdown();
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

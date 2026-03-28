type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[(process.env.LOG_LEVEL as LogLevel) ?? "info"] ?? 1;

function emit(level: LogLevel, component: string, msg: string, extra?: Record<string, unknown>) {
	if (LEVELS[level] < minLevel) return;
	const entry = { ts: new Date().toISOString(), level, component, msg, ...extra };
	const out = JSON.stringify(entry);
	if (level === "error") {
		process.stderr.write(`${out}\n`);
	} else {
		process.stdout.write(`${out}\n`);
	}
}

export function createLogger(component: string) {
	return {
		debug: (msg: string, extra?: Record<string, unknown>) => emit("debug", component, msg, extra),
		info: (msg: string, extra?: Record<string, unknown>) => emit("info", component, msg, extra),
		warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", component, msg, extra),
		error: (msg: string, extra?: Record<string, unknown>) => emit("error", component, msg, extra),
	};
}

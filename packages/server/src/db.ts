import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createLogger } from "./logger.js";

const log = createLogger("db");
const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDb(): Database.Database {
	if (!db) throw new Error("Database not initialized");
	return db;
}

export function initDb(dbPath?: string): Database.Database {
	const path = dbPath ?? resolve(__dirname, "../../../data/tess.db");
	log.info("opening database", { path });

	db = new Database(path);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	runMigrations(db);
	log.info("database ready");
	return db;
}

function runMigrations(database: Database.Database): void {
	database.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			name TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

	const migrationsDir = resolve(__dirname, "../migrations");
	if (!existsSync(migrationsDir)) return;

	const applied = new Set(
		database
			.prepare("SELECT name FROM _migrations")
			.all()
			.map((r) => (r as { name: string }).name),
	);

	const files = readdirSync(migrationsDir)
		.filter((f) => f.endsWith(".sql"))
		.sort();

	for (const file of files) {
		if (applied.has(file)) continue;

		const sql = readFileSync(resolve(migrationsDir, file), "utf-8");
		log.info("running migration", { file });

		database.exec(sql);
		database.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
	}
}

// --- Game CRUD ---

export interface SaveGameData {
	id: string;
	gameType: "chess" | "go" | "janggi";
	whiteUserId?: string;
	blackUserId?: string;
	difficulty: string;
	result?: string;
	resultReason?: string;
	moves: unknown[];
	pgn?: string;
	boardSize?: number;
	accuracyWhite?: number;
	accuracyBlack?: number;
	acplWhite?: number;
	acplBlack?: number;
	skillLabel?: string;
	skillRating?: string;
	gameSummary?: string;
	moveCount: number;
	durationMs?: number;
}

export function saveGame(data: SaveGameData): void {
	const database = getDb();
	database
		.prepare(
			`INSERT INTO games (id, game_type, white_user_id, black_user_id, difficulty,
			result, result_reason, moves, pgn, board_size,
			accuracy_white, accuracy_black, acpl_white, acpl_black,
			skill_label, skill_rating, game_summary, move_count, duration_ms)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			data.id,
			data.gameType,
			data.whiteUserId ?? null,
			data.blackUserId ?? null,
			data.difficulty,
			data.result ?? null,
			data.resultReason ?? null,
			JSON.stringify(data.moves),
			data.pgn ?? null,
			data.boardSize ?? null,
			data.accuracyWhite ?? null,
			data.accuracyBlack ?? null,
			data.acplWhite ?? null,
			data.acplBlack ?? null,
			data.skillLabel ?? null,
			data.skillRating ?? null,
			data.gameSummary ?? null,
			data.moveCount,
			data.durationMs ?? null,
		);
	log.info("game saved", { id: data.id, gameType: data.gameType });
}

export function getRecentGames(limit = 20, gameType?: string, userId?: string): unknown[] {
	const database = getDb();
	let query = "SELECT * FROM games WHERE 1=1";
	const params: unknown[] = [];

	if (gameType) {
		query += " AND game_type = ?";
		params.push(gameType);
	}
	if (userId) {
		query += " AND (white_user_id = ? OR black_user_id = ?)";
		params.push(userId, userId);
	}

	query += " ORDER BY completed_at DESC LIMIT ?";
	params.push(limit);

	return database.prepare(query).all(...params);
}

export function getGame(id: string): unknown {
	return getDb().prepare("SELECT * FROM games WHERE id = ?").get(id);
}

// --- User CRUD ---

export function upsertUser(id: string, displayName: string, browserKey?: string): void {
	getDb()
		.prepare(
			`INSERT INTO users (id, display_name, browser_key)
			VALUES (?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET last_seen = datetime('now')`,
		)
		.run(id, displayName, browserKey ?? null);
}

export function getUserStats(userId: string): {
	gamesPlayed: number;
	wins: number;
	losses: number;
	draws: number;
	avgAccuracy: number | null;
} {
	const database = getDb();
	const stats = database
		.prepare(
			`SELECT
				COUNT(*) as games_played,
				SUM(CASE WHEN (white_user_id = ? AND result = 'white') OR (black_user_id = ? AND result = 'black') THEN 1 ELSE 0 END) as wins,
				SUM(CASE WHEN (white_user_id = ? AND result = 'black') OR (black_user_id = ? AND result = 'white') THEN 1 ELSE 0 END) as losses,
				SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) as draws,
				AVG(CASE WHEN white_user_id = ? THEN accuracy_white WHEN black_user_id = ? THEN accuracy_black END) as avg_accuracy
			FROM games
			WHERE white_user_id = ? OR black_user_id = ?`,
		)
		.get(userId, userId, userId, userId, userId, userId, userId, userId) as {
		games_played: number;
		wins: number;
		losses: number;
		draws: number;
		avg_accuracy: number | null;
	};

	return {
		gamesPlayed: stats.games_played,
		wins: stats.wins,
		losses: stats.losses,
		draws: stats.draws,
		avgAccuracy: stats.avg_accuracy ? Math.round(stats.avg_accuracy) : null,
	};
}

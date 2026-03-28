-- Users (anonymous guests with bird names)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    browser_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Completed games
CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    game_type TEXT NOT NULL CHECK (game_type IN ('chess', 'go', 'janggi')),
    white_user_id TEXT,
    black_user_id TEXT,
    difficulty TEXT NOT NULL,
    result TEXT, -- 'white', 'black', 'draw'
    result_reason TEXT, -- 'checkmate', 'resignation', 'stalemate', etc.
    moves TEXT NOT NULL, -- JSON array of {san, uci, fen}
    pgn TEXT, -- PGN string for chess
    board_size INTEGER, -- Go only
    accuracy_white REAL,
    accuracy_black REAL,
    acpl_white INTEGER,
    acpl_black INTEGER,
    skill_label TEXT,
    skill_rating TEXT,
    game_summary TEXT, -- LLM-generated narrative
    move_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Player ratings (Glicko-2)
CREATE TABLE IF NOT EXISTS ratings (
    user_id TEXT NOT NULL,
    game_type TEXT NOT NULL CHECK (game_type IN ('chess', 'go', 'janggi')),
    rating REAL NOT NULL DEFAULT 1500,
    rd REAL NOT NULL DEFAULT 350, -- rating deviation
    volatility REAL NOT NULL DEFAULT 0.06,
    games_played INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, game_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_user_id);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_user_id);
CREATE INDEX IF NOT EXISTS idx_games_type ON games(game_type);
CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at);
CREATE INDEX IF NOT EXISTS idx_users_browser ON users(browser_key);

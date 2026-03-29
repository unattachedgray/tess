-- Multiplayer support
CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    game_type TEXT NOT NULL,
    creator_user_id TEXT,
    creator_name TEXT,
    time_initial INTEGER NOT NULL DEFAULT 600,
    time_increment INTEGER NOT NULL DEFAULT 5,
    creator_color TEXT,
    board_size INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'open'
);

-- Federation peer servers
CREATE TABLE IF NOT EXISTS peers (
    url TEXT PRIMARY KEY,
    name TEXT,
    last_seen TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

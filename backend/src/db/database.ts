/**
 * SQLite Database Setup
 * Initializes the database schema on first run.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.resolve(__dirname, '../../data/riftbound.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Create schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS decks (
    id                    TEXT PRIMARY KEY,
    player_id             TEXT NOT NULL,
    name                  TEXT NOT NULL,
    legend_id             TEXT NOT NULL,
    chosen_champion_card_id TEXT,
    card_ids              TEXT NOT NULL,   -- JSON array
    rune_ids              TEXT NOT NULL,    -- JSON array
    battlefield_ids       TEXT NOT NULL,    -- JSON array
    sideboard_ids         TEXT NOT NULL,    -- JSON array
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_decks_player_id ON decks(player_id);
  CREATE INDEX IF NOT EXISTS idx_decks_is_ai ON decks(is_ai_deck) WHERE is_ai_deck = 1;
`);

export default db;

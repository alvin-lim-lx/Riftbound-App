-- Riftbound Database Schema
-- PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

-- ============================================================
-- CARDS (seeded reference data)
-- ============================================================
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Unit', 'Spell', 'Gear', 'Battlefield', 'Legend', 'Rune')),
  cost JSONB,
  domains TEXT[],
  keywords TEXT[],
  stats JSONB,
  abilities JSONB,
  set_name TEXT,
  rarity TEXT CHECK (rarity IN ('Common', 'Rare', 'Epic', 'Legendary')),
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);
CREATE INDEX IF NOT EXISTS idx_cards_domains ON cards USING GIN(domains);
CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_name);

-- ============================================================
-- DECKS
-- ============================================================
CREATE TABLE IF NOT EXISTS decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  legend_id TEXT NOT NULL,
  battlefield_id TEXT,
  card_ids TEXT[] NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decks_owner ON decks(owner_id);

-- ============================================================
-- MATCHES
-- ============================================================
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  players JSONB NOT NULL,  -- [{playerId, deckId, score}]
  winner_id UUID,
  loser_id UUID,
  game_mode TEXT DEFAULT 'casual',
  turns INTEGER DEFAULT 0,
  final_state JSONB,  -- serialized final GameState (sanitized)
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_matches_players ON matches USING GIN(players);
CREATE INDEX IF NOT EXISTS idx_matches_winner ON matches(winner_id);
CREATE INDEX IF NOT EXISTS idx_matches_started ON matches(started_at DESC);

-- ============================================================
-- MATCH ACTIONS (for replay support)
-- ============================================================
CREATE TABLE IF NOT EXISTS match_actions (
  id SERIAL PRIMARY KEY,
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  player_id UUID,
  action JSONB NOT NULL,  -- GameAction
  turn INTEGER NOT NULL,
  phase TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_actions_match ON match_actions(match_id);

-- ============================================================
-- SEED: Insert card data
-- (Populated from shared/src/cards.ts at startup)
-- ============================================================

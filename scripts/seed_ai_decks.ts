'use strict';

const fs = require('fs');
const path = require('path');

// ── Load CARDS from cards.ts source ─────────────────────────────────────────

const CARDS_PATH = path.join(__dirname, '../shared/src/cards.ts');
const cardsRaw = fs.readFileSync(CARDS_PATH, 'utf-8');

interface CardDef {
  id: string;
  name: string;
  type: string;
  superType?: string;
  tags?: string[];
  domains?: string[];
  championName?: string;
}

const CARDS = {};

function parseCardBlock(block) {
  const text = block.join('\n');
  const result = {};

  const idMatch = text.match(/id:\s*['"]([a-z0-9-]+)['"]/);
  if (idMatch) result.id = idMatch[1];

  const nameMatch = text.match(/name:\s*['"]([^'"]+)['"]/);
  if (nameMatch) result.name = nameMatch[1];

  const typeMatch = text.match(/type:\s*['"]([A-Za-z]+)['"]/);
  if (typeMatch) result.type = typeMatch[1];

  const superMatch = text.match(/superType:\s*['"]([A-Za-z]+)['"]/);
  if (superMatch) result.superType = superMatch[1];

  const domMatch = text.match(/domains\?:\s*\[([^\]]*)\]/);
  if (domMatch) {
    result.domains = domMatch[1].split(',').map(d => d.trim().replace(/['"]/g, '')).filter(Boolean);
  }

  const tagsMatch = text.match(/tags\?:\s*\[([^\]]*)\]/);
  if (tagsMatch) {
    result.tags = tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')).filter(Boolean);
  }

  const champMatch = text.match(/championName\?:\s*['"]([^'"]+)['"]/);
  if (champMatch) result.championName = champMatch[1];

  return result;
}

const cardEntryMatch = /^\s*('[a-z0-9-]+'):\s*\{/im;
const lines = cardsRaw.split('\n');
let inCard = false;
let braceDepth = 0;
let cardBlock = [];

for (const line of lines) {
  if (!inCard) {
    const m = line.match(cardEntryMatch);
    if (m) {
      inCard = true;
      braceDepth = 0;
      cardBlock = [line];
    }
  } else {
    cardBlock.push(line);
    braceDepth += (line.match(/{/g) || []).length;
    braceDepth -= (line.match(/}/g) || []).length;
    if (braceDepth === 0) {
      const def = parseCardBlock(cardBlock);
      if (def.id && def.name) {
        CARDS[def.id] = def;
      }
      inCard = false;
      cardBlock = [];
    }
  }
}

console.log('Loaded ' + Object.keys(CARDS).length + ' cards');

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripPrefix(name) {
  const comma = name.indexOf(',');
  return comma !== -1 ? name.slice(comma + 1).trim() : name.trim();
}

function findLegendId(name) {
  const stripped = stripPrefix(name);
  const found = Object.values(CARDS).find(
    c => c.type === 'Legend' && (c.name === name || c.name === stripped),
  );
  return found ? found.id : '';
}

function findChampionId(name) {
  const stripped = stripPrefix(name);
  const found = Object.values(CARDS).find(
    c => c.type === 'Unit' && c.superType === 'Champion' && (c.name === name || c.name === stripped),
  );
  return found ? found.id : '';
}

// ── Parse deck text file ──────────────────────────────────────────────────────

function parseDeckTxt(text) {
  const result = {
    legendName: '',
    championName: '',
    cardIds: [],
    runeIds: [],
    battlefieldIds: [],
    sideboardIds: [],
  };

  let section = 'none';
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    const upper = l.toUpperCase();

    if (upper === 'LEGEND:' || upper === 'LEGEND') { section = 'legend'; continue; }
    if (upper === 'CHAMPION:' || upper === 'CHAMPION') { section = 'champion'; continue; }
    if (upper === 'MAINDECK:' || upper === 'MAINDECK') { section = 'main'; continue; }
    if (upper === 'BATTLEFIELDS:' || upper === 'BATTLEFIELDS') { section = 'battlefields'; continue; }
    if (upper === 'RUNES:' || upper === 'RUNES') { section = 'runes'; continue; }
    if (upper === 'SIDEBOARD:' || upper === 'SIDEBOARD') { section = 'sideboard'; continue; }

    const m = l.match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const count = parseInt(m[1], 10);
    const name = m[2].trim();

    if (section === 'legend') {
      result.legendName = name;
    } else if (section === 'champion') {
      result.championName = name;
    } else {
      const card = Object.values(CARDS).find(
        c => c.name === name || c.name === stripPrefix(name),
      );
      if (!card) continue;
      const arr = section === 'main' ? result.cardIds
        : section === 'runes' ? result.runeIds
        : section === 'battlefields' ? result.battlefieldIds
        : section === 'sideboard' ? result.sideboardIds
        : null;
      if (arr) {
        for (let i = 0; i < count; i++) arr.push(card.id);
      }
    }
  }

  return result;
}

// ── Load manifest ─────────────────────────────────────────────────────────────

const manifestPath = path.join(__dirname, '../decks/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

const DECK_FILES = [
  { file: '01_irelia.txt',         idx: 0  },
  { file: '02_vex.txt',             idx: 1  },
  { file: '03_leblanc.txt',         idx: 2  },
  { file: '04_ezreal.txt',          idx: 3  },
  { file: '05_kaisa.txt',           idx: 4  },
  { file: '06_diana_legal.txt',     idx: 5  },
  { file: '07_pyke.txt',            idx: 6  },
  { file: '08_khazix.txt',          idx: 7  },
  { file: '09_draven.txt',          idx: 8  },
  { file: '10_jhin.txt',            idx: 9  },
  { file: '11_lebonk.txt',          idx: 10 },
  { file: '12_diana_midrange.txt',  idx: 11 },
];

const DECKS_DIR = path.join(__dirname, '../decks');

// ── SQLite insert ──────────────────────────────────────────────────────────────

const Database = require('better-sqlite3').default;
const DB_PATH = path.join(__dirname, '../backend/data/riftbound.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

try { db.exec('ALTER TABLE decks ADD COLUMN is_ai_deck INTEGER DEFAULT 0'); } catch {}

db.prepare('DELETE FROM decks WHERE is_ai_deck = 1').run();

let imported = 0;
const errors = [];

for (const { file, idx } of DECK_FILES) {
  const mDeck = manifest[idx];
  if (!mDeck) { errors.push(file + ': manifest entry ' + idx + ' not found'); continue; }

  const txtPath = path.join(DECKS_DIR, file);
  const txt = fs.readFileSync(txtPath, 'utf-8');
  const parsed = parseDeckTxt(txt);

  const legendId = findLegendId(parsed.legendName);
  const championId = findChampionId(parsed.championName);

  if (!legendId) { errors.push(file + ': legend not found "' + parsed.legendName + '"'); continue; }
  if (!championId) { errors.push(file + ': champion not found "' + parsed.championName + '"'); continue; }

  const id = 'ai_deck_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + imported;
  const now = Date.now();

  try {
    db.prepare(`
      INSERT INTO decks (id, player_id, name, legend_id, chosen_champion_card_id,
                         card_ids, rune_ids, battlefield_ids, sideboard_ids,
                         is_ai_deck, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      'ai_system',
      mDeck.name,
      legendId,
      championId,
      JSON.stringify(mDeck.cardIds),
      JSON.stringify(mDeck.runeIds),
      JSON.stringify(mDeck.battlefieldIds),
      JSON.stringify(mDeck.sideboardIds),
      1,
      now,
      now,
    );
    imported++;
    console.log('OK ' + mDeck.name + ' | legend=' + legendId + ' | champ=' + championId + ' | cards=' + mDeck.cardIds.length);
  } catch (e) {
    errors.push(file + ': ' + e.message);
  }
}

console.log('\nImported ' + imported + '/12 AI decks');
if (errors.length > 0) {
  console.log('ERRORS:');
  errors.forEach(e => console.log('  ' + e));
}

db.close();

'use strict';

const fs = require('fs');
const path = require('path');

// Resolve project root (where package.json lives)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CARDS_PATH = path.join(PROJECT_ROOT, 'shared/src/cards.ts');
const cardsRaw = fs.readFileSync(CARDS_PATH, 'utf-8');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'decks/manifest.json');
const DECKS_DIR = path.join(PROJECT_ROOT, 'decks');
const DB_PATH = path.join(PROJECT_ROOT, 'backend/data/riftbound.db');

const CARDS = {};
let count = 0;

function parseCardBlock(block) {
  const text = block.join('\n');

  const idMatch = text.match(/id:\s*['"]([a-z0-9-]+)['"]/);
  const nameMatch = text.match(/name:\s*(['"])(.+?)\1/);
  const typeMatch = text.match(/type:\s*['"]([A-Za-z]+)['"]/);
  const superMatch = text.match(/superType:\s*['"]([A-Za-z]+)['"]/);
  const domMatch = text.match(/domains\?:\s*\[([^\]]*)\]/);
  const tagsMatch = text.match(/tags\?:\s*\[([^\]]*)\]/);
  const champMatch = text.match(/championName\?:\s*['"]([^'"]+)['"]/);

  return {
    id: idMatch ? idMatch[1] : undefined,
    name: nameMatch ? nameMatch[2] : undefined,
    type: typeMatch ? typeMatch[1] : undefined,
    superType: superMatch ? superMatch[1] : undefined,
    domains: domMatch ? domMatch[1].split(',').map(d => d.trim().replace(/['"]/g, '')).filter(Boolean) : undefined,
    tags: tagsMatch ? tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')).filter(Boolean) : undefined,
    championName: champMatch ? champMatch[1] : undefined,
  };
}

const cardEntryMatch = /^\s*'[a-z0-9-]+':\s*\{/im;
const lines = cardsRaw.split('\n');
let inCard = false;
let braceDepth = 0;
let cardBlock = [];

for (const line of lines) {
  if (!inCard) {
    const m = line.match(cardEntryMatch);
    if (m) {
      inCard = true;
      braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
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
        count++;
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
    c => c.type === 'Legend' && (
      c.name === name ||
      c.name === stripped ||
      c.name.includes(stripped) ||
      stripped.includes(c.name)
    ),
  );
  return found ? found.id : '';
}

function findChampionId(name) {
  const stripped = stripPrefix(name);
  const found = Object.values(CARDS).find(
    c => c.type === 'Unit' && c.superType === 'Champion' && (c.name === stripped || stripPrefix(c.name) === stripped),
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
    const cnt = parseInt(m[1], 10);
    const cardName = m[2].trim();

    if (section === 'legend') {
      result.legendName = cardName;
    } else if (section === 'champion') {
      result.championName = cardName;
    } else {
      const card = Object.values(CARDS).find(
        c => c.name === cardName || c.name === stripPrefix(cardName),
      );
      if (!card) continue;
      let arr = null;
      if (section === 'main') arr = result.cardIds;
      else if (section === 'runes') arr = result.runeIds;
      else if (section === 'battlefields') arr = result.battlefieldIds;
      else if (section === 'sideboard') arr = result.sideboardIds;
      if (arr) {
        for (let i = 0; i < cnt; i++) arr.push(card.id);
      }
    }
  }

  return result;
}

// ── Load manifest ─────────────────────────────────────────────────────────────

const manifestPath = path.join(PROJECT_ROOT, 'decks/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

const DECK_FILES = [
  { file: '01_irelia.txt',  idx: 0  },
  { file: '02_vex.txt',     idx: 1  },
  { file: '03_leblanc.txt', idx: 2  },
  { file: '04_ezreal.txt',  idx: 3  },
  { file: '05_kaisa.txt',   idx: 4  },
  { file: '06_diana.txt',   idx: 5  },
  { file: '07_pyke.txt',    idx: 6  },
  { file: '08_leesin.txt',  idx: 7  },
  { file: '09_sett.txt',    idx: 8  },
  { file: '10_garen.txt',   idx: 9  },
  { file: '11_draven.txt',  idx: 10 },
  { file: '12_jhin.txt',    idx: 11 },
];

// ── SQLite insert ──────────────────────────────────────────────────────────────

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Resolve ai_test user id (for FK constraint on player_id), create if missing
let aiTestUser = db.prepare("SELECT id FROM users WHERE username = 'ai_test'").get();
if (!aiTestUser) {
  const userId = 'user_' + Math.random().toString(36).slice(2, 10);
  const hash = bcrypt.hashSync('test', 12);
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(userId, 'ai_test', hash, Date.now());
  aiTestUser = db.prepare("SELECT id FROM users WHERE username = 'ai_test'").get();
}
const PLAYER_ID = aiTestUser ? aiTestUser.id : null;

try { db.exec('ALTER TABLE decks ADD COLUMN is_ai_deck INTEGER DEFAULT 0'); } catch { /* already exists */ }

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
  if (!championId) { console.log('WARN ' + file + ': champion not found "' + parsed.championName + '" — setting NULL'); }

  const deckId = 'ai_deck_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + imported;
  const now = Date.now();

  try {
    const sql = "INSERT INTO decks (id, player_id, name, legend_id, chosen_champion_card_id, " +
      "card_ids, rune_ids, battlefield_ids, sideboard_ids, is_ai_deck, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    db.prepare(sql).run(
      deckId,
      PLAYER_ID,
      mDeck.name,
      legendId,
      championId || null,
      JSON.stringify(mDeck.cardIds),
      JSON.stringify(mDeck.runeIds),
      JSON.stringify(mDeck.battlefieldIds),
      JSON.stringify(mDeck.sideboardIds),
      1,
      now,
      now,
    );
    imported++;
    console.log(
      'OK ' + mDeck.name +
      ' | legend=' + legendId + ' (' + (CARDS[legendId] ? CARDS[legendId].name : '?') + ')' +
      ' | champ=' + championId + ' (' + (CARDS[championId] ? CARDS[championId].name : '?') + ')' +
      ' | cards=' + mDeck.cardIds.length
    );
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

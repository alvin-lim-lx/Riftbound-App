/**
 * Deck Import Utilities — Piltover Code & Text Format
 * ===================================================
 * Supports two import formats:
 *
 * 1. TEXT FORMAT (full deck specification):
 *    Legend:
 *    1 LeBlanc, Deceiver
 *    Champion:
 *    1 LeBlanc, Everywhere at Once
 *    MainDeck:
 *    3 Watchful Sentry
 *    ...
 *
 * 2. PILTOVER CODE (base64-encoded binary):
 *    CMAAAAAAAAAACAQAAFM5MAIAAABAKAAAMB4NCOVAH...
 *
 * Card name → CardDefinition lookup uses exact matching against
 * CARDS[].name (the scraped Riot gallery names, e.g. "Deceiver", not
 * the Piltover Archive full names like "LeBlanc, Deceiver").
 */

import { CARDS } from '@shared/cards';
import type { CardDefinition } from '@shared/types';

// ─── Name Matching ────────────────────────────────────────────────────────────

/** Strip champion prefix from a Piltover Archive name: "LeBlanc, Deceiver" → "Deceiver" */
function stripChampionPrefix(name: string): string {
  const comma = name.indexOf(',');
  return comma !== -1 ? name.slice(comma + 1).trim() : name.trim();
}

/** Unescape common escape sequences found in the card database names.
 *  Handles: \' → '  (JavaScript/JSON string escape for apostrophe) */
function unescapeName(name: string): string {
  return name.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** Find a card by name in the full 939-card database (no isNormalCard filter).
 *  For imports, we want to find whatever the user types, even if it has
 *  alternate-art / letter-suffix variants. Tries exact match first,
 *  then strips champion prefix (for Piltover Archive names like "LeBlanc, Deceiver"
 *  which in CARDS is just "Deceiver"). Also handles escaped apostrophes
 *  in the database (e.g. "Kai\'Sa" will match user input "Kai'Sa"). */
function findCardByName(name: string): CardDefinition | null {
  const trimmed = name.trim();
  // Try exact match across all cards (with unescape normalization)
  const exact = Object.values(CARDS).find(c => unescapeName(c.name) === trimmed);
  if (exact) return exact;
  // Try stripped name (handles "LeBlanc, Deceiver" → "Deceiver")
  const stripped = stripChampionPrefix(trimmed);
  if (stripped !== trimmed) {
    return Object.values(CARDS).find(c => unescapeName(c.name) === stripped) ?? null;
  }
  return null;
}

// ─── Piltover Code Decoder (LoR Deck Code v1) ────────────────────────────────

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function charToVal(c: string): number {
  const idx = ALPHABET.indexOf(c);
  if (idx === -1) throw new Error(`Invalid deck code character: ${c}`);
  return idx;
}

function readVarint(bytes: number[], pos: { value: number }): number {
  let result = 0;
  let shift = 0;
  while (pos.value < bytes.length) {
    const b = bytes[pos.value];
    pos.value++;
    result |= (b & 0x7f) << shift;
    shift += 7;
    if ((b & 0x80) === 0) break;
  }
  return result;
}

/** Decode a LoR/Piltover Archive deck code to an array of {set, num, copies}.
 *  Returns raw values that need to be mapped to Riftbound card IDs.
 *
 *  The LoR deck code format packs 8 characters into 6 bytes (each char = 6 bits).
 *  Cards are encoded as 3 consecutive LEB128 varints: [setId, cardNum, copies].
 *  The first 3 bytes are a header (version byte + topOfDeck flag). */
function decodePiltoverCodeRaw(code: string): Array<{ set: number; num: number; copies: number }> {
  if (!code || code.length < 8) throw new Error('Invalid deck code (too short)');

  // Version check — version is top 5 bits of first char
  const version = charToVal(code[0]) >> 3;
  if (version !== 1) throw new Error(`Unsupported deck code version: ${version}`);

  // Convert code to byte array using 8-char → 6-byte base64-style decoding.
  // Each character holds 6 bits. 8 chars × 6 = 48 bits = 6 bytes.
  const bytes: number[] = [];
  for (let i = 0; i < code.length; i += 8) {
    const chunk = code.slice(i, i + 8);
    // Pad to 8 chars so we don't read past the end of the string
    const indices = chunk.padEnd(8, 'A').split('').map(charToVal);

    // Bytes 0-5 from 8 × 6-bit characters:
    // char0[5..0]      → byte0[7..2]   (top 6 bits)
    // char0[1..0]+char1[5..2] → byte0[1..0] + byte1[7..6] (2+4 = 6 bits)
    // char1[1..0]+char2[5..4] → byte1[5..0]
    // char2[3..0]+char3[5..2] → byte2[7..0]
    // char3[1..0]+char4[5..4] → byte3[7..0]? (this gets complex; use standard lookup)
    bytes.push((indices[0] << 2) | (indices[1] >> 4));
    bytes.push(((indices[1] & 0xf) << 4) | (indices[2] >> 2));
    bytes.push(((indices[2] & 0x3) << 6) | indices[3]);
    bytes.push((indices[4] << 2) | (indices[5] >> 4));
    bytes.push(((indices[5] & 0xf) << 4) | (indices[6] >> 2));
    bytes.push(((indices[6] & 0x3) << 6) | indices[7]);
  }

  // The first 3 bytes are a header: [version+flags, 0, 0]
  // If the header starts with 0x00 0x00 (or version=0, flags=0), strip it.
  // Most valid deck codes have 0x00 0x00 at bytes 1-2 of the header.
  const headerByte0 = bytes[0];
  const topOfDeckFlag = (headerByte0 >> 3) & 1; // unused in Riftbound but present

  // Skip the 3-byte header before reading card varints
  const cards: Array<{ set: number; num: number; copies: number }> = [];
  const pos = { value: 3 }; // start after 3-byte header

  while (pos.value < bytes.length) {
    const setId = readVarint(bytes, pos);
    const cardNum = readVarint(bytes, pos);
    const copies = readVarint(bytes, pos);

    // FOTD sentinel: setId=0, cardNum=0 marks end of main deck
    if (setId === 0 && cardNum === 0) break;
    if (copies === 0) break;
    // Sanity check — skip obviously bad entries
    if (setId > 100 || cardNum > 5000) break;

    cards.push({ set: setId, num: cardNum, copies });
  }

  return cards;
}

// ─── Riftbound Set ID Mapping ────────────────────────────────────────────────

/** Map a LoR-style set identifier (set index) to a Riftbound set prefix.
 *  This builds a FOTD (Figure Out The Details) lookup table from the CARDS database. */
function buildFOTD(): Map<string, string> {
  // Map: "F{setId}:{registerId}" → cardId
  // where setId maps to a set prefix via SET_INDEX
  const fotd = new Map<string, string>();

  // Set index → Riftbound set prefix
  const SET_INDEX: Record<number, string> = {
    1: 'ogn',   // Origins
    2: 'sfd',   // Spiritforged
    3: 'unl',   // Unleashed
    4: 'pgs',   // Proving Grounds
    5: 'btf',   // Beyond the Fold
    // More sets can be added as identified
  };

  // Build lookup: scan all cards and assign F-codes
  // For each card with id like "ogn-001-298":
  // - Extract number "001" and prefix "ogn"  
  // - Find the setIndex for "ogn" → 1
  // - Register = card number within the set
  // - Key = "F{setIndex}:{register}"
  for (const [cardId, card] of Object.entries(CARDS)) {
    const match = cardId.match(/^([a-z]+)-(\d+)-(\d+)$/);
    if (!match) continue;
    const [, setPrefix, numStr] = match;
    const setIndex = Object.entries(SET_INDEX).find(([, p]) => p === setPrefix)?.[0];
    if (!setIndex) continue;
    const register = parseInt(numStr, 10);
    const key = `F${setIndex}:${register}`;
    if (!fotd.has(key)) {
      fotd.set(key, cardId);
    }
  }

  return fotd;
}

// Lazily build FOTD on first use
let fotdCache: Map<string, string> | null = null;
function getFOTD(): Map<string, string> {
  if (!fotdCache) fotdCache = buildFOTD();
  return fotdCache;
}

/** Find a Riftbound card by its F{set}:{register} code.
 *  The Piltover code encodes cards as F{set}:{register}:{copies}. */
function findCardByFCode(setId: number, registerId: number): CardDefinition | null {
  const fotd = getFOTD();
  const key = `F${setId}:${registerId}`;
  const cardId = fotd.get(key);
  return cardId ? CARDS[cardId] ?? null : null;
}

// ─── Main Import Functions ───────────────────────────────────────────────────

export interface ImportedDeck {
  legendName: string;
  chosenChampionName: string;
  cardIds: string[];        // main deck (NOT including chosen champion)
  runeIds: string[];
  battlefieldIds: string[];
  sideboardIds: string[];
  errors: string[];
}

/** Parse a Piltover Archive text-format deck string. */
export function parseDeckText(text: string): ImportedDeck {
  const result: ImportedDeck = {
    legendName: '',
    chosenChampionName: '',
    cardIds: [],
    runeIds: [],
    battlefieldIds: [],
    sideboardIds: [],
    errors: [],
  };

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let section: 'legend' | 'champion' | 'main' | 'battlefields' | 'runes' | 'sideboard' | 'none' = 'none';

  for (const line of lines) {
    const upper = line.toUpperCase();

    // Section headers
    if (upper === 'LEGEND:' || upper === 'LEGEND') { section = 'legend'; continue; }
    if (upper === 'CHAMPION:' || upper === 'CHAMPION') { section = 'champion'; continue; }
    if (upper === 'MAINDECK:' || upper === 'MAINDECK') { section = 'main'; continue; }
    if (upper === 'BATTLEFIELDS:' || upper === 'BATTLEFIELDS') { section = 'battlefields'; continue; }
    if (upper === 'RUNES:' || upper === 'RUNES') { section = 'runes'; continue; }
    if (upper === 'SIDEBOARD:' || upper === 'SIDEBOARD') { section = 'sideboard'; continue; }

    // Parse: "3 Watchful Sentry" or "1 LeBlanc, Deceiver"
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;

    const count = parseInt(match[1], 10);
    const name = match[2].trim();
    const card = findCardByName(name);

    if (!card) {
      result.errors.push(`Card not found: "${name}"`);
      continue;
    }

    switch (section) {
      case 'legend':
        result.legendName = name;
        break;
      case 'champion':
        result.chosenChampionName = name;
        break;
      case 'main':
        if (card.type === 'Legend') {
          result.errors.push(`Legend "${name}" should not be in main deck.`);
        } else if (card.type === 'Unit' || card.type === 'Spell' || card.type === 'Gear') {
          for (let i = 0; i < count; i++) result.cardIds.push(card.id);
        }
        break;
      case 'runes':
        if (card.type === 'Rune') {
          for (let i = 0; i < count; i++) result.runeIds.push(card.id);
        } else {
          result.errors.push(`Rune "${name}" is type ${card.type}, not Rune.`);
        }
        break;
      case 'battlefields':
        if (card.type === 'Battlefield') {
          for (let i = 0; i < count; i++) result.battlefieldIds.push(card.id);
        } else {
          result.errors.push(`Battlefield "${name}" is type ${card.type}, not Battlefield.`);
        }
        break;
      case 'sideboard':
        if (card.type === 'Legend') {
          result.errors.push(`Legend "${name}" cannot be in sideboard.`);
        } else {
          for (let i = 0; i < count; i++) result.sideboardIds.push(card.id);
        }
        break;
    }
  }

  return result;
}

/** Parse a Piltover Archive base64-encoded deck code. */
export function parsePiltoverCode(code: string): ImportedDeck {
  const result: ImportedDeck = {
    legendName: '',
    chosenChampionName: '',
    cardIds: [],
    runeIds: [],
    battlefieldIds: [],
    sideboardIds: [],
    errors: [],
  };

  try {
    const rawCards = decodePiltoverCodeRaw(code);

    if (rawCards.length === 0) {
      result.errors.push('Could not decode any cards from deck code.');
      return result;
    }

    // Map raw (set, num, copies) to card IDs
    for (const raw of rawCards) {
      const card = findCardByFCode(raw.set, raw.num);
      if (!card) {
        result.errors.push(`Card F${raw.set}:${raw.num} not found in database.`);
        continue;
      }

      for (let i = 0; i < raw.copies; i++) {
        if (card.type === 'Legend') {
          result.legendName = card.name;
        } else if (card.type === 'Unit' && card.superType === 'Champion') {
          result.chosenChampionName = card.name;
        } else if (card.type === 'Battlefield') {
          result.battlefieldIds.push(card.id);
        } else if (card.type === 'Rune') {
          result.runeIds.push(card.id);
        } else if (card.type === 'Unit' || card.type === 'Spell' || card.type === 'Gear') {
          result.cardIds.push(card.id);
        } else {
          result.sideboardIds.push(card.id);
        }
      }
    }
  } catch (e) {
    result.errors.push(`Deck code parse error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}

/** Auto-detect format and parse a deck import string (code or text). */
export function parseDeckImport(input: string): ImportedDeck {
  // Only text format is supported — parse as deck list text
  return parseDeckText(input.trim());
}

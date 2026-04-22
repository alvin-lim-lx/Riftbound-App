"use strict";
/**
 * Deck Manager — Backend Service
 * ===============================
 * SQLite-backed deck storage with validation against the card database.
 * Provides CRUD operations for player decks.
 *
 * Deck structure (per official Riftbound rules Section 101):
 *   - 1 Champion Legend (type=Legend)  → Legend Zone, never shuffled
 *   - 1 Chosen Champion (type=Champion) → Champion Zone, never shuffled
 *   - Main Deck 39 cards (Units/Spells/Gears) — the Chosen Champion is
 *     already separated out and NOT part of this list
 *   - Rune Deck 12 Rune cards
 *   - Battlefields (Mode-dependent)
 *   - 8 sideboard cards
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeckManager = void 0;
const cards_1 = require("../../shared/src/cards");
const database_1 = __importDefault(require("../db/database"));
function rowToDeck(row) {
    return {
        id: row['id'],
        playerId: row['player_id'],
        name: row['name'],
        legendId: row['legend_id'],
        chosenChampionCardId: row['chosen_champion_card_id'] ?? null,
        cardIds: JSON.parse(row['card_ids']),
        runeIds: JSON.parse(row['rune_ids']),
        battlefieldIds: JSON.parse(row['battlefield_ids']),
        sideboardIds: JSON.parse(row['sideboard_ids']),
        isAiDeck: row['is_ai_deck'] === 1,
        createdAt: row['created_at'],
        updatedAt: row['updated_at'],
    };
}
class DeckManager {
    // ─────────────────────────────────────────────────────────
    // CRUD — SQLite-backed
    // ─────────────────────────────────────────────────────────
    static create(playerId, name, legendId, chosenChampionCardId, cardIds, runeIds, battlefieldIds, sideboardIds, isAiDeck = false) {
        const id = `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        database_1.default.prepare(`
      INSERT INTO decks (id, player_id, name, legend_id, chosen_champion_card_id,
                         card_ids, rune_ids, battlefield_ids, sideboard_ids,
                         is_ai_deck, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, playerId, name, legendId, chosenChampionCardId, JSON.stringify(cardIds), JSON.stringify(runeIds), JSON.stringify(battlefieldIds), JSON.stringify(sideboardIds), isAiDeck ? 1 : 0, now, now);
        return { id, playerId, name, legendId, chosenChampionCardId, cardIds, runeIds, battlefieldIds, sideboardIds, isAiDeck, createdAt: now, updatedAt: now };
    }
    static get(id) {
        const row = database_1.default.prepare('SELECT * FROM decks WHERE id = ?').get(id);
        return row ? rowToDeck(row) : undefined;
    }
    static getByPlayer(playerId) {
        const rows = database_1.default
            .prepare('SELECT * FROM decks WHERE player_id = ? ORDER BY updated_at DESC')
            .all(playerId);
        return rows.map(rowToDeck);
    }
    static update(id, patches) {
        const existing = database_1.default.prepare('SELECT * FROM decks WHERE id = ?').get(id);
        if (!existing)
            return null;
        const current = rowToDeck(existing);
        const merged = { ...current, ...patches };
        const now = Date.now();
        database_1.default.prepare(`
      UPDATE decks SET
        name = ?, legend_id = ?, chosen_champion_card_id = ?,
        card_ids = ?, rune_ids = ?, battlefield_ids = ?, sideboard_ids = ?, updated_at = ?
      WHERE id = ?
    `).run(merged.name, merged.legendId, merged.chosenChampionCardId, JSON.stringify(merged.cardIds), JSON.stringify(merged.runeIds), JSON.stringify(merged.battlefieldIds), JSON.stringify(merged.sideboardIds), now, id);
        return { ...merged, updatedAt: now };
    }
    static delete(id) {
        const info = database_1.default.prepare('DELETE FROM decks WHERE id = ?').run(id);
        return info.changes > 0;
    }
    static getRandomAiDeck() {
        const rows = database_1.default
            .prepare('SELECT * FROM decks WHERE is_ai_deck = 1 ORDER BY RANDOM() LIMIT 1')
            .all();
        return rows.length > 0 ? rowToDeck(rows[0]) : undefined;
    }
    // ─────────────────────────────────────────────────────────
    // Validation helpers
    // ─────────────────────────────────────────────────────────
    static extractChampionTag(name) {
        const comma = name.indexOf(',');
        return comma !== -1 ? name.slice(0, comma).trim() : name.trim();
    }
    static domainsMatch(legendDomains, cardDomains, isBattlefield = false) {
        if (cardDomains.includes('Colorless'))
            return true;
        if (isBattlefield && cardDomains.length === 0)
            return true;
        if (cardDomains.length === 0)
            return true;
        if (legendDomains.length === 0)
            return true;
        return legendDomains.some(d => cardDomains.includes(d));
    }
    // ─────────────────────────────────────────────────────────
    // Validation (Section 101)
    // ─────────────────────────────────────────────────────────
    static validate(deck) {
        const errors = [];
        const warnings = [];
        const legend = cards_1.CARDS[deck.legendId];
        if (!legend) {
            errors.push(`Legend card "${deck.legendId}" not found in card database.`);
        }
        else if (legend.type !== 'Legend') {
            errors.push(`Selected legend "${legend.name}" is type '${legend.type}', expected 'Legend'.`);
        }
        const legendDomains = legend?.domains ?? [];
        const legendTag = legend?.championName ?? null;
        const chosenChampion = deck.chosenChampionCardId ? cards_1.CARDS[deck.chosenChampionCardId] : null;
        if (!chosenChampion) {
            if (deck.chosenChampionCardId) {
                errors.push(`Chosen Champion card "${deck.chosenChampionCardId}" not found in card database.`);
            }
        }
        else {
            if (chosenChampion.superType !== 'Champion') {
                errors.push(`Chosen Champion "${chosenChampion.name}" is superType '${chosenChampion.superType}', expected 'Champion'.`);
            }
            if (legendTag) {
                const champTag = chosenChampion.tags?.includes(legendTag) ? legendTag :
                    chosenChampion.tags?.[0] ?? DeckManager.extractChampionTag(chosenChampion.name);
                if (champTag !== legendTag) {
                    errors.push(`Chosen Champion "${chosenChampion.name}" has tag "${champTag}" — does not match legend "${legend.name}" tag "${legendTag}".`);
                }
            }
            if (legend &&
                chosenChampion.domains.length > 0 &&
                !DeckManager.domainsMatch(legendDomains, chosenChampion.domains)) {
                errors.push(`Chosen Champion "${chosenChampion.name}" has domains [${chosenChampion.domains.join(', ')}] — does not share any domain with legend "${legend.name}" [${legendDomains.join(', ')}].`);
            }
        }
        const mainDeckSize = deck.cardIds.length;
        if (mainDeckSize !== 40) {
            errors.push(`Main deck has ${mainDeckSize} cards, must be exactly 40 (Chosen Champion is part of the main deck and extracted during setup).`);
        }
        const nameCount = {};
        let signatureCount = 0;
        for (const cardId of deck.cardIds) {
            const card = cards_1.CARDS[cardId];
            if (!card) {
                errors.push(`Main deck card "${cardId}" not found in card database.`);
                continue;
            }
            nameCount[card.name] = (nameCount[card.name] ?? 0) + 1;
            if (card.type === 'Legend') {
                errors.push(`Legend card "${card.name}" must not be in main deck.`);
            }
            if (!['Unit', 'Spell', 'Gear'].includes(card.type)) {
                errors.push(`Main deck card "${card.name}" is type '${card.type}', expected Unit/Spell/Gear.`);
            }
            if (legend && !DeckManager.domainsMatch(legendDomains, card.domains)) {
                errors.push(`Card "${card.name}" has domains [${card.domains.join(', ')}] — does not share any domain with legend "${legend.name}" [${legendDomains.join(', ')}].`);
            }
            if (card.superType === 'Signature') {
                signatureCount += 1;
            }
        }
        for (const [name, count] of Object.entries(nameCount)) {
            if (count > 3) {
                errors.push(`Too many copies of "${name}" in main deck (${count}x, max 3).`);
            }
        }
        if (signatureCount > 3) {
            errors.push(`Deck has ${signatureCount} Signature cards, maximum is 3 total (103.2.d).`);
        }
        const runeCount = deck.runeIds.length;
        if (runeCount !== 12) {
            errors.push(`Rune deck has ${runeCount} cards, must be exactly 12.`);
        }
        const seenRuneNames = {};
        for (const runeId of deck.runeIds) {
            const rune = cards_1.CARDS[runeId];
            if (!rune) {
                errors.push(`Rune "${runeId}" not found in card database.`);
            }
            else if (rune.type !== 'Rune') {
                errors.push(`Card "${rune.name}" is type '${rune.type}', expected 'Rune' for rune deck.`);
            }
            else {
                if (legend && !DeckManager.domainsMatch(legendDomains, rune.domains)) {
                    errors.push(`Rune "${rune.name}" has domains [${rune.domains.join(', ')}] — does not share any domain with legend "${legend.name}" [${legendDomains.join(', ')}].`);
                }
                seenRuneNames[rune.name] = (seenRuneNames[rune.name] ?? 0) + 1;
            }
        }
        const bfCount = deck.battlefieldIds.length;
        if (bfCount === 0) {
            errors.push('Deck has no battlefields (Mode of Play requires at least 1).');
        }
        const seenBattlefieldNames = {};
        for (const bfId of deck.battlefieldIds) {
            const bf = cards_1.CARDS[bfId];
            if (!bf) {
                errors.push(`Battlefield "${bfId}" not found in card database.`);
            }
            else if (bf.type !== 'Battlefield') {
                errors.push(`Card "${bf.name}" is type '${bf.type}', expected 'Battlefield'.`);
            }
            else {
                seenBattlefieldNames[bf.name] = (seenBattlefieldNames[bf.name] ?? 0) + 1;
                if (seenBattlefieldNames[bf.name] > 1) {
                    errors.push(`Battlefield "${bf.name}" appears ${seenBattlefieldNames[bf.name]} times (max 1 per name, 103.4.c).`);
                }
                if (legend && !DeckManager.domainsMatch(legendDomains, bf.domains, true)) {
                    errors.push(`Battlefield "${bf.name}" has domains [${bf.domains.join(', ')}] — does not share any domain with legend "${legend.name}" [${legendDomains.join(', ')}].`);
                }
            }
        }
        const sbCount = deck.sideboardIds.length;
        if (sbCount > 8) {
            errors.push(`Sideboard has ${sbCount} cards, maximum is 8.`);
        }
        const sbNameCount = {};
        for (const sbId of deck.sideboardIds) {
            const card = cards_1.CARDS[sbId];
            if (!card) {
                errors.push(`Sideboard card "${sbId}" not found in card database.`);
            }
            else {
                if (card.type === 'Legend') {
                    errors.push(`Legend card "${card.name}" cannot be in sideboard.`);
                }
                if (legend && !DeckManager.domainsMatch(legendDomains, card.domains)) {
                    errors.push(`Sideboard card "${card.name}" has domains [${card.domains.join(', ')}] — does not share any domain with legend "${legend.name}" [${legendDomains.join(', ')}].`);
                }
                sbNameCount[card.name] = (sbNameCount[card.name] ?? 0) + 1;
                if (sbNameCount[card.name] > 3) {
                    errors.push(`Sideboard has ${sbNameCount[card.name]} copies of "${card.name}" (max 3).`);
                }
            }
        }
        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            cardCount: mainDeckSize,
            championCount: 1,
            signatureCount,
            runeCount: deck.runeIds.length,
            battlefieldCount: bfCount,
            sideboardCount: sbCount,
        };
    }
    // ─────────────────────────────────────────────────────────
    // Game integration
    // ─────────────────────────────────────────────────────────
    // Build full game pool from deck:
    // - Legend (1) — goes to Legend Zone
    // - Chosen Champion (1) — goes to Champion Zone
    // - Remaining 39 cards — shuffled, no duplication
    // - Rune cards (12) — separate rune deck
    static expandDeck(deck) {
        // Shuffle rune deck
        const runeDeck = [...deck.runeIds];
        for (let i = runeDeck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [runeDeck[i], runeDeck[j]] = [runeDeck[j], runeDeck[i]];
        }
        // Separate champion from the 40 cardIds
        const championId = deck.chosenChampionCardId;
        const mainDeckCardIds = deck.cardIds.filter(id => id !== championId);
        // mainDeckCardIds should be 39 — shuffle as-is
        const shuffledMainDeck = [...mainDeckCardIds];
        for (let i = shuffledMainDeck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledMainDeck[i], shuffledMainDeck[j]] = [shuffledMainDeck[j], shuffledMainDeck[i]];
        }
        // Return: [legend, champion, ...shuffledMainDeck (39), ...runeDeck (12)] = 53 cards total
        return [deck.legendId, championId, ...shuffledMainDeck, ...runeDeck];
    }
}
exports.DeckManager = DeckManager;

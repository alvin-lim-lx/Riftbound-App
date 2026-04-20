"use strict";
/**
 * Deck Manager — Backend Service
 * ===============================
 * In-memory deck storage with validation against the card database.
 * Provides CRUD operations for player decks.
 *
 * Deck structure (Piltover legal format):
 *   - 1 Legend card (type=Legend, plays on board)
 *   - 39 main deck cards (Units/Spells/Gears, includes champion unit)
 *   - 12 rune deck cards (2 copies each of 6 rune types)
 *   - 3 battlefields (first is starting battlefield)
 *   - 8 sideboard cards
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeckManager = void 0;
const cards_1 = require("../../shared/src/cards");
const store = new Map();
class DeckManager {
    // ─────────────────────────────────────────────────────────
    // CRUD
    // ─────────────────────────────────────────────────────────
    static create(playerId, name, legendId, cardIds, runeIds, battlefieldIds, sideboardIds) {
        const id = `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        const deck = {
            id,
            playerId,
            name,
            legendId,
            cardIds,
            runeIds,
            battlefieldIds,
            sideboardIds,
            createdAt: now,
            updatedAt: now,
        };
        store.set(id, deck);
        return deck;
    }
    static get(id) {
        return store.get(id);
    }
    static getByPlayer(playerId) {
        return Array.from(store.values()).filter(d => d.playerId === playerId);
    }
    static update(id, patches) {
        const existing = store.get(id);
        if (!existing)
            return null;
        const updated = {
            ...existing,
            ...patches,
            updatedAt: Date.now(),
        };
        store.set(id, updated);
        return updated;
    }
    static delete(id) {
        return store.delete(id);
    }
    // ─────────────────────────────────────────────────────────
    // Validation
    // ─────────────────────────────────────────────────────────
    static validate(deck) {
        const errors = [];
        const warnings = [];
        // ── Legend ──────────────────────────────────────────────
        const legend = cards_1.CARDS[deck.legendId];
        if (!legend) {
            errors.push(`Legend card "${deck.legendId}" not found in card database.`);
        }
        else if (legend.type !== 'Legend') {
            errors.push(`Selected legend "${legend.name}" (${deck.legendId}) is type '${legend.type}', expected 'Legend'.`);
        }
        // ── Main deck (39 cards: Unit/Spell/Gear, no Legend) ────
        const cardCount = {};
        let championCount = 0;
        if (deck.cardIds.length !== 39) {
            warnings.push(`Main deck has ${deck.cardIds.length} cards, expected 39.`);
        }
        for (const cardId of deck.cardIds) {
            cardCount[cardId] = (cardCount[cardId] ?? 0) + 1;
            if (!cards_1.CARDS[cardId]) {
                errors.push(`Main deck card "${cardId}" not found in card database.`);
            }
            else {
                const def = cards_1.CARDS[cardId];
                if (def.type === 'Legend') {
                    errors.push(`Legend card "${def.name}" must be set as the deck's legend, not in main deck.`);
                }
                else if (!['Unit', 'Spell', 'Gear'].includes(def.type)) {
                    errors.push(`Main deck card "${def.name}" is type '${def.type}', expected Unit/Spell/Gear.`);
                }
                if (def.superType === 'Champion')
                    championCount++;
            }
        }
        // Max 2 copies of any card in main deck
        for (const [cardId, count] of Object.entries(cardCount)) {
            if (count > 2) {
                const cardName = cards_1.CARDS[cardId]?.name ?? cardId;
                errors.push(`Too many copies of "${cardName}" in main deck (${count}x, max 2).`);
            }
        }
        // ── Rune deck (12 cards: Rune type) ─────────────────────
        const runeCount = deck.runeIds.length;
        if (runeCount !== 12) {
            warnings.push(`Rune deck has ${runeCount} cards, expected 12.`);
        }
        for (const runeId of deck.runeIds) {
            if (!cards_1.CARDS[runeId]) {
                errors.push(`Rune "${runeId}" not found in card database.`);
            }
            else if (cards_1.CARDS[runeId].type !== 'Rune') {
                errors.push(`Card "${cards_1.CARDS[runeId].name}" is type '${cards_1.CARDS[runeId].type}', expected 'Rune' for rune deck.`);
            }
        }
        // ── Battlefields (3 cards: Battlefield type) ─────────────
        const bfCount = deck.battlefieldIds.length;
        if (bfCount !== 3) {
            warnings.push(`Deck has ${bfCount} battlefields, expected 3.`);
        }
        for (const bfId of deck.battlefieldIds) {
            if (!cards_1.CARDS[bfId]) {
                errors.push(`Battlefield "${bfId}" not found in card database.`);
            }
            else if (cards_1.CARDS[bfId].type !== 'Battlefield') {
                errors.push(`Card "${cards_1.CARDS[bfId].name}" is type '${cards_1.CARDS[bfId].type}', expected 'Battlefield'.`);
            }
        }
        // ── Sideboard (8 cards: Unit/Spell/Gear, no Legend) ──────
        if (deck.sideboardIds.length !== 8) {
            warnings.push(`Sideboard has ${deck.sideboardIds.length} cards, expected 8.`);
        }
        for (const sbId of deck.sideboardIds) {
            if (!cards_1.CARDS[sbId]) {
                errors.push(`Sideboard card "${sbId}" not found in card database.`);
            }
            else {
                const def = cards_1.CARDS[sbId];
                if (def.type === 'Legend') {
                    errors.push(`Legend card "${def.name}" cannot be in sideboard.`);
                }
                else if (!['Unit', 'Spell', 'Gear'].includes(def.type)) {
                    errors.push(`Sideboard card "${def.name}" is type '${def.type}', expected Unit/Spell/Gear.`);
                }
            }
        }
        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            cardCount: deck.cardIds.length,
            championCount,
            runeCount: deck.runeIds.length,
            battlefieldCount: deck.battlefieldIds.length,
            sideboardCount: deck.sideboardIds.length,
        };
    }
    // ─────────────────────────────────────────────────────────
    // Game integration — expand deck to full card instance ids
    // ─────────────────────────────────────────────────────────
    /**
     * Expand a deck into card instance ids for game initialization.
     * Returns array of card ids:
     *   - 1 legend
     *   - 2 copies of each main deck card
     *   - 2 copies of each rune card
     * Shuffled (legend position is preserved separately, not shuffled).
     */
    static expandDeck(deck) {
        const result = [];
        // Add legend once (at start, not shuffled in)
        result.push(deck.legendId);
        // Add 2 copies of each main deck card
        for (const cardId of deck.cardIds) {
            result.push(cardId, cardId);
        }
        // Add 2 copies of each rune card
        for (const runeId of deck.runeIds) {
            result.push(runeId, runeId);
        }
        // Shuffle using simple Fisher-Yates (legend stays at position 0 for now)
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        // Move legend back to front after shuffle
        const legend = result.shift();
        result.unshift(legend);
        return result;
    }
}
exports.DeckManager = DeckManager;

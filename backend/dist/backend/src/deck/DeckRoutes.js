"use strict";
/**
 * Deck REST Routes
 * Mounted at /api/decks on the Express app
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeckRouter = createDeckRouter;
const express_1 = require("express");
const DeckManager_1 = require("./DeckManager");
function createDeckRouter() {
    const router = (0, express_1.Router)();
    // GET /api/decks?playerId=xxx
    router.get('/', (req, res) => {
        const playerId = req.query.playerId;
        if (!playerId) {
            return res.status(400).json({ error: 'playerId query param required' });
        }
        const decks = DeckManager_1.DeckManager.getByPlayer(playerId);
        res.json({ decks });
    });
    // GET /api/decks/:id
    router.get('/:id', (req, res) => {
        const deck = DeckManager_1.DeckManager.get(req.params.id);
        if (!deck)
            return res.status(404).json({ error: 'Deck not found' });
        res.json({ deck });
    });
    // POST /api/decks
    router.post('/', (req, res) => {
        const { playerId, name, legendId, cardIds = [], runeIds = [], battlefieldIds = [], sideboardIds = [], } = req.body;
        if (!playerId || !name || !legendId) {
            return res.status(400).json({ error: 'playerId, name, and legendId required' });
        }
        const validation = DeckManager_1.DeckManager.validate({
            name,
            legendId,
            cardIds,
            runeIds,
            battlefieldIds,
            sideboardIds,
        });
        if (!validation.isValid) {
            return res.status(400).json({ error: 'Invalid deck', validation });
        }
        const deck = DeckManager_1.DeckManager.create(playerId, name, legendId, cardIds, runeIds, battlefieldIds, sideboardIds);
        res.status(201).json({ deck, validation });
    });
    // POST /api/decks/bulk
    // Body: { playerId: string, decks: Omit<Deck, 'id' | 'playerId' | 'createdAt' | 'updatedAt'>[] }
    router.post('/bulk', (req, res) => {
        const { playerId, decks } = req.body;
        if (!playerId) {
            return res.status(400).json({ error: 'playerId required' });
        }
        if (!Array.isArray(decks) || decks.length === 0) {
            return res.status(400).json({ error: 'decks must be a non-empty array' });
        }
        const results = [];
        for (const deckInput of decks) {
            const { name, legendId, cardIds = [], runeIds = [], battlefieldIds = [], sideboardIds = [] } = deckInput;
            if (!name || !legendId) {
                results.push({ name: name ?? '(unnamed)', success: false, error: 'name and legendId required' });
                continue;
            }
            const validation = DeckManager_1.DeckManager.validate({ name, legendId, cardIds, runeIds, battlefieldIds, sideboardIds });
            if (!validation.isValid) {
                results.push({ name, success: false, error: 'Validation failed', validation });
                continue;
            }
            try {
                const deck = DeckManager_1.DeckManager.create(playerId, name, legendId, cardIds, runeIds, battlefieldIds, sideboardIds);
                results.push({ name, success: true, deck, validation });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                results.push({ name, success: false, error: message });
            }
        }
        const allSucceeded = results.every(r => r.success);
        const statusCode = allSucceeded ? 201 : 207; // 207 Multi-Status if partial
        res.status(statusCode).json({
            total: results.length,
            succeeded: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results,
        });
    });
    // PUT /api/decks/:id
    router.put('/:id', (req, res) => {
        const { name, legendId, cardIds, runeIds, battlefieldIds, sideboardIds, } = req.body;
        const existing = DeckManager_1.DeckManager.get(req.params.id);
        if (!existing)
            return res.status(404).json({ error: 'Deck not found' });
        const patches = {};
        if (name !== undefined)
            patches.name = name;
        if (legendId !== undefined)
            patches.legendId = legendId;
        if (cardIds !== undefined)
            patches.cardIds = cardIds;
        if (runeIds !== undefined)
            patches.runeIds = runeIds;
        if (battlefieldIds !== undefined)
            patches.battlefieldIds = battlefieldIds;
        if (sideboardIds !== undefined)
            patches.sideboardIds = sideboardIds;
        if (Object.keys(patches).length > 0) {
            const validation = DeckManager_1.DeckManager.validate({
                name: patches.name ?? existing.name,
                legendId: patches.legendId ?? existing.legendId,
                cardIds: patches.cardIds ?? existing.cardIds,
                runeIds: patches.runeIds ?? existing.runeIds,
                battlefieldIds: patches.battlefieldIds ?? existing.battlefieldIds,
                sideboardIds: patches.sideboardIds ?? existing.sideboardIds,
            });
            if (!validation.isValid) {
                return res.status(400).json({ error: 'Invalid deck', validation });
            }
        }
        const updated = DeckManager_1.DeckManager.update(req.params.id, patches);
        res.json({ deck: updated });
    });
    // DELETE /api/decks/:id
    router.delete('/:id', (req, res) => {
        const deleted = DeckManager_1.DeckManager.delete(req.params.id);
        if (!deleted)
            return res.status(404).json({ error: 'Deck not found' });
        res.json({ success: true });
    });
    // POST /api/decks/validate — validate without saving
    router.post('/validate', (req, res) => {
        const { name, legendId, cardIds = [], runeIds = [], battlefieldIds = [], sideboardIds = [], } = req.body;
        const validation = DeckManager_1.DeckManager.validate({
            name: name ?? '',
            legendId: legendId ?? '',
            cardIds,
            runeIds,
            battlefieldIds,
            sideboardIds,
        });
        res.json({ validation });
    });
    return router;
}

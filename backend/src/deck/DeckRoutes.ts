/**
 * Deck REST Routes
 * Mounted at /api/decks on the Express app
 *
 * Auth:
 *   GET  /           → list decks for authenticated user (playerId from JWT)
 *   GET  /:id        → get single deck (must own it — playerId from JWT)
 *   POST /           → create deck (requires JWT; playerId from JWT)
 *   POST /bulk       → bulk create decks (requires JWT; playerId from JWT)
 *   PUT  /:id        → update deck (requires JWT; must own it)
 *   DELETE /:id      → delete deck (requires JWT; must own it)
 *   POST /validate   → validate deck without saving (no auth required)
 */

import { Router, Request, Response } from 'express';
import { DeckManager } from './DeckManager';
import type { Deck, DeckValidation } from '../../shared/src/types';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

export function createDeckRouter(): Router {
  const router = Router();

  // GET /api/decks — list decks for the authenticated user
  router.get('/', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const decks = DeckManager.getByPlayer(req.user!.userId);
    res.json({ decks });
  });

  // GET /api/decks/:id — get a single deck (only if owned by requester)
  router.get('/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const deck = DeckManager.get(req.params.id);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    if (deck.playerId !== req.user!.userId) {
      return res.status(403).json({ error: 'You do not have permission to view this deck' });
    }
    res.json({ deck });
  });

  // POST /api/decks — create a new deck
  router.post('/', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const {
      name,
      legendId,
      chosenChampionCardId,
      cardIds = [],
      runeIds = [],
      battlefieldIds = [],
      sideboardIds = [],
    } = req.body;

    if (!name || !legendId) {
      return res.status(400).json({ error: 'name and legendId required' });
    }

    const validation = DeckManager.validate({
      name,
      legendId,
      chosenChampionCardId,
      cardIds,
      runeIds,
      battlefieldIds,
      sideboardIds,
    });
    if (!validation.isValid) {
      return res.status(400).json({ error: 'Invalid deck', validation });
    }

    const deck = DeckManager.create(
      req.user!.userId,  // playerId from JWT — not from request body
      name,
      legendId,
      chosenChampionCardId,
      cardIds,
      runeIds,
      battlefieldIds,
      sideboardIds,
    );
    res.status(201).json({ deck, validation });
  });

  // POST /api/decks/bulk — bulk create decks
  router.post('/bulk', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { decks } = req.body;

    if (!Array.isArray(decks) || decks.length === 0) {
      return res.status(400).json({ error: 'decks must be a non-empty array' });
    }

    const playerId = req.user!.userId;
    const results: {
      name: string;
      success: boolean;
      deck?: Deck;
      validation?: DeckValidation;
      error?: string;
    }[] = [];

    for (const deckInput of decks) {
      const {
        name,
        legendId,
        chosenChampionCardId,
        cardIds = [],
        runeIds = [],
        battlefieldIds = [],
        sideboardIds = [],
      } = deckInput;

      if (!name || !legendId || !chosenChampionCardId) {
        results.push({
          name: name ?? '(unnamed)',
          success: false,
          error: 'name, legendId, and chosenChampionCardId required',
        });
        continue;
      }

      const validation = DeckManager.validate({
        name,
        legendId,
        chosenChampionCardId,
        cardIds,
        runeIds,
        battlefieldIds,
        sideboardIds,
      });
      if (!validation.isValid) {
        results.push({ name, success: false, error: 'Validation failed', validation });
        continue;
      }

      try {
        const deck = DeckManager.create(
          playerId,
          name,
          legendId,
          chosenChampionCardId,
          cardIds,
          runeIds,
          battlefieldIds,
          sideboardIds,
        );
        results.push({ name, success: true, deck, validation });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ name, success: false, error: message });
      }
    }

    const allSucceeded = results.every(r => r.success);
    const statusCode = allSucceeded ? 201 : 207;

    res.status(statusCode).json({
      total: results.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  });

  // PUT /api/decks/:id/draft — save a partial/in-progress deck without validation
  router.put('/:id/draft', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const existing = DeckManager.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Deck not found' });
    if (existing.playerId !== req.user!.userId) {
      return res.status(403).json({ error: 'You do not have permission to edit this deck' });
    }

    const {
      name,
      legendId,
      chosenChampionCardId,
      cardIds,
      runeIds,
      battlefieldIds,
      sideboardIds,
    } = req.body;

    const patches: Parameters<typeof DeckManager.update>[1] = {};
    if (name !== undefined) patches.name = name;
    if (legendId !== undefined) patches.legendId = legendId;
    if (chosenChampionCardId !== undefined) patches.chosenChampionCardId = chosenChampionCardId;
    if (cardIds !== undefined) patches.cardIds = cardIds;
    if (runeIds !== undefined) patches.runeIds = runeIds;
    if (battlefieldIds !== undefined) patches.battlefieldIds = battlefieldIds;
    if (sideboardIds !== undefined) patches.sideboardIds = sideboardIds;

    const updated = DeckManager.update(req.params.id, patches);
    res.json({ deck: updated, draft: true });
  });

  // PUT /api/decks/:id — update an existing deck (owner only)
  router.put('/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const existing = DeckManager.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Deck not found' });

    // Auth check: can only edit your own deck
    if (existing.playerId !== req.user!.userId) {
      return res.status(403).json({ error: 'You do not have permission to edit this deck' });
    }

    const {
      name,
      legendId,
      chosenChampionCardId,
      cardIds,
      runeIds,
      battlefieldIds,
      sideboardIds,
    } = req.body;

    const patches: Parameters<typeof DeckManager.update>[1] = {};
    if (name !== undefined) patches.name = name;
    if (legendId !== undefined) patches.legendId = legendId;
    if (chosenChampionCardId !== undefined) patches.chosenChampionCardId = chosenChampionCardId;
    if (cardIds !== undefined) patches.cardIds = cardIds;
    if (runeIds !== undefined) patches.runeIds = runeIds;
    if (battlefieldIds !== undefined) patches.battlefieldIds = battlefieldIds;
    if (sideboardIds !== undefined) patches.sideboardIds = sideboardIds;

    if (Object.keys(patches).length > 0) {
      const validation = DeckManager.validate({
        name: patches.name ?? existing.name,
        legendId: patches.legendId ?? existing.legendId,
        chosenChampionCardId: patches.chosenChampionCardId ?? existing.chosenChampionCardId,
        cardIds: patches.cardIds ?? existing.cardIds,
        runeIds: patches.runeIds ?? existing.runeIds,
        battlefieldIds: patches.battlefieldIds ?? existing.battlefieldIds,
        sideboardIds: patches.sideboardIds ?? existing.sideboardIds,
      });
      if (!validation.isValid) {
        return res.status(400).json({ error: 'Invalid deck', validation });
      }
    }

    const updated = DeckManager.update(req.params.id, patches);
    res.json({ deck: updated });
  });

  // DELETE /api/decks/:id — delete a deck (owner only)
  router.delete('/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const existing = DeckManager.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Deck not found' });

    // Auth check: can only delete your own deck
    if (existing.playerId !== req.user!.userId) {
      return res.status(403).json({ error: 'You do not have permission to delete this deck' });
    }

    const deleted = DeckManager.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Deck not found' });
    res.json({ success: true });
  });

  // POST /api/decks/validate — validate without saving (no auth required)
  router.post('/validate', (req: Request, res: Response) => {
    const {
      name,
      legendId,
      chosenChampionCardId,
      cardIds = [],
      runeIds = [],
      battlefieldIds = [],
      sideboardIds = [],
    } = req.body;

    const validation = DeckManager.validate({
      name: name ?? '',
      legendId: legendId ?? '',
      chosenChampionCardId: chosenChampionCardId ?? '',
      cardIds,
      runeIds,
      battlefieldIds,
      sideboardIds,
    });
    res.json({ validation });
  });

  return router;
}

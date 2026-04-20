/**
 * Battlefield Unit Tests — Issue #1 fix verification
 * Tests that all 3 battlefields are created and visible on the game board.
 */

import { createGame } from '../src/engine/GameEngine';

const P1 = 'player_1';
const P2 = 'player_2';

describe('Battlefield — Issue #1: Missing battlefield on game board', () => {
  describe('createGame with deck config (AI/human games)', () => {
    it('creates all 3 battlefields when deck config provides battlefieldIds', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob'], {
        playerDecks: {
          [P1]: {
            legendId: 'unl-l01',
            chosenChampionCardId: 'unl-c01',
            cardIds: [],
            battlefieldIds: ['Baron_Pit', 'Brush', 'The_Grid'],
          },
          [P2]: {
            legendId: 'unl-l01',
            chosenChampionCardId: 'unl-c01',
            cardIds: [],
            battlefieldIds: ['Baron_Pit', 'Brush', 'The_Grid'],
          },
        },
      });

      // All 3 battlefields must be present
      expect(state.battlefields.length).toBe(3);

      // Each battlefield must have a unique id
      const bfIds = state.battlefields.map(bf => bf.id);
      expect(new Set(bfIds).size).toBe(3);
      expect(bfIds).toContain('bf_0');
      expect(bfIds).toContain('bf_1');
      expect(bfIds).toContain('bf_2');

      // Each battlefield must have a name and cardId
      for (const bf of state.battlefields) {
        expect(bf.name).toBeTruthy();
        expect(bf.cardId).toBeTruthy();
        expect(bf.units).toEqual([]);
        expect(bf.controllerId).toBeNull();
      }
    });

    it('creates all 3 battlefields when deck provides fewer than 3 (pads with defaults)', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob'], {
        playerDecks: {
          [P1]: {
            legendId: 'unl-l01',
            chosenChampionCardId: 'unl-c01',
            cardIds: [],
            battlefieldIds: ['Baron_Pit'], // only 1 BF provided
          },
          [P2]: {
            legendId: 'unl-l01',
            chosenChampionCardId: 'unl-c01',
            cardIds: [],
            battlefieldIds: [],
          },
        },
      });

      // Must still produce 3 battlefields (padded with defaults)
      expect(state.battlefields.length).toBe(3);
    });

    it('battlefields are present in game state for UI rendering', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob'], {
        playerDecks: {
          [P1]: {
            legendId: 'unl-l01',
            chosenChampionCardId: 'unl-c01',
            cardIds: [],
            battlefieldIds: ['Baron_Pit', 'Brush', 'The_Grid'],
          },
          [P2]: {
            legendId: 'unl-l01',
            chosenChampionCardId: 'unl-c01',
            cardIds: [],
            battlefieldIds: ['Baron_Pit', 'Brush', 'The_Grid'],
          },
        },
      });

      // QA test GE-1.4: Game has 3 battlefields
      expect(state.battlefields.length).toBe(3);

      // Each battlefield card must have valid cardId pointing to a card definition
      const cardIds = state.battlefields.map(bf => bf.cardId);
      for (const cardId of cardIds) {
        expect(cardId).toBeTruthy();
      }
    });
  });

  describe('createGame without deck config (fallback defaults)', () => {
    it('creates 3 battlefields using default battlefield names', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);

      // GE-1.4: Game has 3 battlefields
      expect(state.battlefields.length).toBe(3);

      const bfIds = state.battlefields.map(bf => bf.id);
      expect(bfIds).toContain('bf_0');
      expect(bfIds).toContain('bf_1');
      expect(bfIds).toContain('bf_2');
    });
  });
});

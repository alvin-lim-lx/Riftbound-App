/**
 * Battlefield setup tests.
 */

import { createGame } from '../src/engine/GameEngine';

const P1 = 'player_1';
const P2 = 'player_2';
const centerBattlefields = (state: ReturnType<typeof createGame>) =>
  state.battlefields.filter(bf => !bf.id.startsWith('base_'));

describe('Battlefield setup', () => {
  describe('createGame with deck config (AI/human games)', () => {
    it('creates one Bo1 battlefield from each player deck', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob'], {
        playerDecks: {
          [P1]: {
            legendId: 'unl-l01',
            chosenChampionCardId: 'unl-c01',
            cardIds: [],
            battlefieldIds: ['Baron_Pit'],
          },
          [P2]: {
            legendId: 'unl-l01',
            chosenChampionCardId: 'unl-c01',
            cardIds: [],
            battlefieldIds: ['Brush'],
          },
        },
      });

      const battlefields = centerBattlefields(state);
      expect(battlefields.length).toBe(2);
      expect(state.battlefields.map(bf => bf.id)).toEqual(expect.arrayContaining([`base_${P1}`, `base_${P2}`]));

      const bfIds = battlefields.map(bf => bf.id);
      expect(new Set(bfIds).size).toBe(2);
      expect(bfIds).toContain('bf_0');
      expect(bfIds).toContain('bf_1');
      expect(battlefields.map(bf => bf.cardId)).toEqual(['unl-t01', 'unl-t03']);

      for (const bf of battlefields) {
        expect(bf.name).toBeTruthy();
        expect(bf.cardId).toBeTruthy();
        expect(bf.units).toEqual([]);
        expect(bf.controllerId).toBeNull();
      }
    });

    it('chooses Bo1 battlefields from each player candidate list', () => {
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

      const battlefields = centerBattlefields(state);
      expect(battlefields.length).toBe(2);
      const allowedCardIds = new Set(['unl-t01', 'unl-t03', 'sfd-214-221']);
      for (const bf of battlefields) {
        expect(allowedCardIds.has(bf.cardId)).toBe(true);
      }
    });

    it('can still create all 3 battlefields for Bo3-style setup', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob'], {
        matchFormat: 'bo3',
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

      const battlefields = centerBattlefields(state);
      expect(battlefields.length).toBe(3);
      const cardIds = battlefields.map(bf => bf.cardId);
      for (const cardId of cardIds) {
        expect(cardId).toBeTruthy();
      }
    });
  });

  describe('createGame without deck config (fallback defaults)', () => {
    it('creates two Bo1 battlefields using default candidates', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);

      const battlefields = centerBattlefields(state);
      expect(battlefields.length).toBe(2);

      const bfIds = battlefields.map(bf => bf.id);
      expect(bfIds).toContain('bf_0');
      expect(bfIds).toContain('bf_1');
    });
  });
});

/**
 * Zone Cards Unit Tests — Issue #4 fix verification
 * Tests that Legend and Champion cards are correctly placed in their zones
 * with the proper location strings that the frontend's partitionPlayerZones() checks for.
 */

import { createGame } from '../src/engine/GameEngine';
import type { CardInstance } from '../shared/src/types';

const P1 = 'player_1';
const P2 = 'player_2';

describe('Zone Cards — Issue #4: Legend and Champion zones are empty', () => {
  describe('Legend card location string', () => {
    it('places legend card with location "legend" (not "legendZone")', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob'], {
        playerDecks: {
          [P1]: {
            legendId: 'ogn-247-298',  // Daughter of the Void — actual Legend card
            chosenChampionCardId: 'ogn-027-298',  // Darius, Trifarian — actual Champion unit
            cardIds: [],
            battlefieldIds: ['Baron_Pit', 'Brush', 'The_Grid'],
          },
          [P2]: {
            legendId: 'ogn-247-298',  // Daughter of the Void — actual Legend card
            chosenChampionCardId: 'ogn-027-298',  // Darius, Trifarian — actual Champion unit
            cardIds: [],
            battlefieldIds: ['Baron_Pit', 'Brush', 'The_Grid'],
          },
        },
      });

      // Find the legend card for P1
      const legendCard = Object.values(state.allCards).find(
        (c: CardInstance) => c.ownerId === P1 && state.cardDefinitions[c.cardId]?.type === 'Legend'
      );

      expect(legendCard).toBeDefined();
      // The frontend's partitionPlayerZones() checks for 'legend', not 'legendZone'
      expect(legendCard!.location).toBe('legend');
    });
  });

  describe('Champion card location string', () => {
    it('places champion card with location "championZone"', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob'], {
        playerDecks: {
          [P1]: {
            legendId: 'ogn-247-298',  // Daughter of the Void — actual Legend card
            chosenChampionCardId: 'ogn-027-298',  // Darius, Trifarian — actual Champion unit
            cardIds: [],
            battlefieldIds: ['Baron_Pit', 'Brush', 'The_Grid'],
          },
          [P2]: {
            legendId: 'ogn-247-298',  // Daughter of the Void — actual Legend card
            chosenChampionCardId: 'ogn-027-298',  // Darius, Trifarian — actual Champion unit
            cardIds: [],
            battlefieldIds: ['Baron_Pit', 'Brush', 'The_Grid'],
          },
        },
      });

      // Find the champion card for P1
      const championCard = Object.values(state.allCards).find(
        (c: CardInstance) =>
          c.ownerId === P1 &&
          state.cardDefinitions[c.cardId]?.type === 'Unit' &&
          state.cardDefinitions[c.cardId]?.superType === 'Champion'
      );

      expect(championCard).toBeDefined();
      expect(championCard!.location).toBe('championZone');
    });
  });

  describe('partitionPlayerZones compatibility', () => {
    it('legend card is discoverable by frontend partitionPlayerZones with "legend" check', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob'], {
        playerDecks: {
          [P1]: {
            legendId: 'ogn-247-298',  // Daughter of the Void — actual Legend card
            chosenChampionCardId: 'ogn-027-298',  // Darius, Trifarian — actual Champion unit
            cardIds: [],
            battlefieldIds: ['Baron_Pit', 'Brush', 'The_Grid'],
          },
          [P2]: {
            legendId: 'ogn-247-298',  // Daughter of the Void — actual Legend card
            chosenChampionCardId: 'ogn-027-298',  // Darius, Trifarian — actual Champion unit
            cardIds: [],
            battlefieldIds: ['Baron_Pit', 'Brush', 'The_Grid'],
          },
        },
      });

      // Simulate what partitionPlayerZones() does in BoardLayout.tsx
      // It checks: c.location === 'battlefield' || c.location === 'legend' || c.location === 'championZone'
      const legendIds: string[] = [];
      const championIds: string[] = [];

      for (const c of Object.values(state.allCards) as CardInstance[]) {
        if (c.ownerId !== P1) continue;
        const def = state.cardDefinitions[c.cardId];
        if (!def) continue;

        if (c.location === 'battlefield' || c.location === 'legend' || c.location === 'championZone') {
          if (def.type === 'Legend') legendIds.push(c.instanceId);
          else if (def.type === 'Unit' && def.superType === 'Champion') championIds.push(c.instanceId);
        }
      }

      expect(legendIds.length).toBeGreaterThan(0);
      expect(championIds.length).toBeGreaterThan(0);
    });
  });
});

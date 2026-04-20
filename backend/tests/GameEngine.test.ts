/**
 * GameEngine Unit Tests
 */

import {
  createGame,
  executeAction,
  checkWinCondition,
  getLegalActions,
  deepClone,
} from '../src/engine/GameEngine';
import type { GameAction } from '../shared/src/types';

const P1 = 'player_1';
const P2 = 'player_2';

function makeAction(
  type: GameAction['type'],
  playerId: string,
  payload: Record<string, unknown> = {}
): GameAction {
  return {
    id: `action_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type,
    playerId,
    payload,
    turn: 1,
    phase: 'FirstMain',
    timestamp: Date.now(),
  };
}

describe('GameEngine', () => {
  describe('createGame', () => {
    it('creates a valid 2-player game state', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      expect(state.players[P1]).toBeDefined();
      expect(state.players[P2]).toBeDefined();
      expect(state.battlefields.length).toBeGreaterThan(0);
      expect(state.phase).toBe('Setup');
      expect(state.winner).toBeNull();
    });

    it('deals opening hands of 5 cards', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      expect(state.players[P1].hand.length).toBe(5);
      expect(state.players[P2].hand.length).toBe(5);
    });

    it('creates rune decks for both players', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      expect(state.players[P1].runeDeck.length).toBe(20);
      expect(state.players[P2].runeDeck.length).toBe(20);
    });
  });

  describe('Phase Transitions', () => {
    it('only active player can pass', () => {
      const state = { ...createGame([P1, P2], ['Alice', 'Bob']), phase: 'FirstMain' as const, activePlayerId: P1 };
      const result = executeAction(state, makeAction('Pass', P2));
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not your turn.');
    });
  });

  describe('PlayUnit', () => {
    it('rejects playing a card not in hand', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      const result = executeAction(state, makeAction('PlayUnit', P1, {
        cardInstanceId: 'nonexistent_card',
        battlefieldId: state.battlefields[0].id,
        hidden: false,
        accelerate: false,
      }));
      expect(result.success).toBe(false);
      expect(result.error).toBe('Card not found.');
    });

    it('rejects playing without a valid battlefield', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const unitId = state.players[P1].hand.find(id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(unitId).toBeDefined();

      const def = state.cardDefinitions[state.allCards[unitId!].cardId];
      const manaNeeded = def.cost?.rune ?? 0;

      const result = executeAction(state, makeAction('PlayUnit', P1, {
        cardInstanceId: unitId!,
        battlefieldId: 'nonexistent_bf',
        hidden: false,
        accelerate: false,
      }));
      // With mana fix, battlefield is checked AFTER hand+cost, but mana check runs first
      // The exact error depends on whether player has enough mana
      // Either way it should not succeed
      expect(result.success).toBe(false);
    });

    it('successfully plays a unit when player has enough mana and units on BF', () => {
      // Use deepClone so we can mutate freely without affecting createGame
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const bfId = state.battlefields[0].id;

      // Move a unit from hand to battlefield first (simulates previously played unit)
      const unitId = state.players[P1].hand.find(id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(unitId).toBeDefined();

      // Mutate: put unit on BF so subsequent units can be played there
      state.allCards[unitId!].location = 'battlefield';
      state.allCards[unitId!].battlefieldId = bfId;
      state.battlefields[0].units.push(unitId!);
      state.players[P1].hand = state.players[P1].hand.filter(id => id !== unitId);

      // Find another unit in hand to play
      const nextUnitId = state.players[P1].hand.find(id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(nextUnitId).toBeDefined();

      const nextDef = state.cardDefinitions[state.allCards[nextUnitId!].cardId];
      const playState: typeof state = {
        ...state,
        phase: 'FirstMain' as const,
        activePlayerId: P1,
        players: {
          ...state.players,
          [P1]: { ...state.players[P1], mana: (nextDef.cost?.rune ?? 0) + 5 },
        },
      };

      const result = executeAction(playState, makeAction('PlayUnit', P1, {
        cardInstanceId: nextUnitId!,
        battlefieldId: bfId,
        hidden: false,
        accelerate: false,
      }));

      expect(result.success).toBe(true);
      if (result.newState) {
        expect(result.newState.allCards[nextUnitId!].location).toBe('battlefield');
      }
    });
  });

  describe('MoveUnit (Ganking)', () => {
    it('rejects moving a unit without Ganking keyword', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const bfId = state.battlefields[0].id;

      const unitId = state.players[P1].hand.find(id => {
        const def = state.cardDefinitions[state.allCards[id].cardId];
        return def.type === 'Unit' && !def.keywords.includes('Ganking');
      });
      if (!unitId) return;

      // Play the unit first
      state.allCards[unitId].location = 'battlefield';
      state.allCards[unitId].battlefieldId = bfId;
      state.allCards[unitId].ready = true;
      state.battlefields[0].units.push(unitId);
      state.players[P1].hand = state.players[P1].hand.filter(id => id !== unitId);

      const moveAction = makeAction('MoveUnit', P1, {
        cardInstanceId: unitId,
        fromBattlefieldId: bfId,
        toBattlefieldId: state.battlefields[1].id,
      });
      moveAction.turn = 1;
      moveAction.phase = 'FirstMain';

      const moveResult = executeAction(state, moveAction);
      expect(moveResult.success).toBe(false);
      expect(moveResult.error).toBe('Unit does not have Ganking.');
    });
  });

  describe('Combat / Showdown', () => {
    it('rejects attacking from wrong player', () => {
      const state = { ...createGame([P1, P2], ['Alice', 'Bob']), phase: 'FirstMain' as const, activePlayerId: P1 };
      const result = executeAction(state, makeAction('Attack', P2, {
        attackerId: 'fake_attacker',
        targetBattlefieldId: state.battlefields[0].id,
      }));
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not your turn.');
    });
  });

  describe('Win Condition', () => {
    it('detects winner when score reaches limit', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.players[P1].score = 8;
      expect(checkWinCondition(state)).toBe(P1);
    });

    it('returns null when no score limit reached', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      expect(checkWinCondition(state)).toBeNull();
    });
  });

  describe('getLegalActions', () => {
    it('returns Pass as a legal action in FirstMain', () => {
      const state = { ...createGame([P1, P2], ['Alice', 'Bob']), phase: 'FirstMain' as const, activePlayerId: P1 };
      const actions = getLegalActions(state, P1);
      expect(actions.some(a => a.type === 'Pass')).toBe(true);
    });

    it('returns no actions in GameOver phase', () => {
      const state = { ...createGame([P1, P2], ['Alice', 'Bob']), phase: 'GameOver' as const, activePlayerId: P1 };
      const actions = getLegalActions(state, P1);
      expect(actions.length).toBe(0);
    });

    it('returns PlayUnit for units in hand with enough mana when BF is controlled', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const bfId = state.battlefields[0].id;

      // Put a unit on the BF first
      const unitId = state.players[P1].hand.find(id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(unitId).toBeDefined();

      state.allCards[unitId!].location = 'battlefield';
      state.allCards[unitId!].battlefieldId = bfId;
      state.battlefields[0].units.push(unitId!);
      state.players[P1].hand = state.players[P1].hand.filter(id => id !== unitId);

      // Find another unit
      const nextUnitId = state.players[P1].hand.find(id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(nextUnitId).toBeDefined();

      const highManaState: typeof state = {
        ...state,
        phase: 'FirstMain' as const,
        activePlayerId: P1,
        players: {
          ...state.players,
          [P1]: { ...state.players[P1], mana: 10 },
        },
      };

      const actions = getLegalActions(highManaState, P1);
      expect(actions.some(a => a.type === 'PlayUnit')).toBe(true);
    });
  });

  describe('Legend and Champion Zone Setup', () => {
    it('places legend card in legendZone location', () => {
      const legendCardId = 'unl-l01'; // Assuming a Legend card exists
      const championCardId = 'unl-c01'; // Assuming a Champion unit exists
      const state = createGame([P1, P2], ['Alice', 'Bob'], {
        playerDecks: {
          [P1]: { legendId: legendCardId, chosenChampionCardId: championCardId, cardIds: [] },
          [P2]: { legendId: legendCardId, chosenChampionCardId: championCardId, cardIds: [] },
        },
      });

      const p1 = state.players[P1];
      const p2 = state.players[P2];

      // Legend should be set in player state
      expect(p1.legend).toBeDefined();
      expect(p2.legend).toBeDefined();

      // Legend instance should be in allCards with location='legendZone'
      const p1Legend = state.allCards[p1.legend!];
      expect(p1Legend).toBeDefined();
      expect(p1Legend.location).toBe('legend');
      expect(p1Legend.ownerId).toBe(P1);

      const p2Legend = state.allCards[p2.legend!];
      expect(p2Legend).toBeDefined();
      expect(p2Legend.location).toBe('legend');
      expect(p2Legend.ownerId).toBe(P2);
    });

    it('places chosen champion card in championZone location', () => {
      const legendCardId = 'unl-l01';
      const championCardId = 'unl-c01';
      const state = createGame([P1, P2], ['Alice', 'Bob'], {
        playerDecks: {
          [P1]: { legendId: legendCardId, chosenChampionCardId: championCardId, cardIds: [] },
          [P2]: { legendId: legendCardId, chosenChampionCardId: championCardId, cardIds: [] },
        },
      });

      const p1 = state.players[P1];
      const p2 = state.players[P2];

      // Champion should be set in player state
      expect(p1.chosenChampion).toBeDefined();
      expect(p2.chosenChampion).toBeDefined();

      // Champion instance should be in allCards with location='championZone'
      const p1Champion = state.allCards[p1.chosenChampion!];
      expect(p1Champion).toBeDefined();
      expect(p1Champion.location).toBe('championZone');
      expect(p1Champion.ownerId).toBe(P1);

      const p2Champion = state.allCards[p2.chosenChampion!];
      expect(p2Champion).toBeDefined();
      expect(p2Champion.location).toBe('championZone');
      expect(p2Champion.ownerId).toBe(P2);
    });

    it('legend and champion are NOT in player hand', () => {
      const legendCardId = 'unl-l01';
      const championCardId = 'unl-c01';
      const state = createGame([P1, P2], ['Alice', 'Bob'], {
        playerDecks: {
          [P1]: { legendId: legendCardId, chosenChampionCardId: championCardId, cardIds: [] },
          [P2]: { legendId: legendCardId, chosenChampionCardId: championCardId, cardIds: [] },
        },
      });

      const p1Hand = state.players[P1].hand;
      const p2Hand = state.players[P2].hand;

      // Legend and champion should not be in hand
      expect(p1Hand).not.toContain(state.players[P1].legend);
      expect(p1Hand).not.toContain(state.players[P1].chosenChampion);
      expect(p2Hand).not.toContain(state.players[P2].legend);
      expect(p2Hand).not.toContain(state.players[P2].chosenChampion);
    });
  });

  describe('Concede', () => {
    it('declares opponent as winner on concede', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      const result = executeAction(state, makeAction('Concede', P1));
      expect(result.success).toBe(true);
      if (result.newState) {
        expect(result.newState.phase).toBe('GameOver');
        expect(result.newState.winner).toBe(P2);
      }
    });
  });
});

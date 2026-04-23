/**
 * GameLog Unit Tests
 *
 * Issue #6: Full game logs - actionLog should record all meaningful
 * game actions so the game can be replayed from the log.
 */

import { createGame, executeAction, deepClone } from '../src/engine/GameEngine';
import type { GameAction } from '../../shared/src/types';

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

describe('GameLog', () => {
  describe('actionLog exists and has GameStart entry', () => {
    it('createGame initializes actionLog with GameStart entry', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      expect(state.actionLog).toBeDefined();
      expect(Array.isArray(state.actionLog)).toBe(true);
      expect(state.actionLog.length).toBe(1);
      expect(state.actionLog[0].type).toBe('GameStart');
      expect((state.actionLog[0] as any).message).toContain('Game started');
    });
  });

  describe('PlayUnit action', () => {
    it('records PlayUnit action in actionLog after successful execution', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const bfId = state.battlefields[0].id;

      // Find a unit in hand
      const unitId = state.players[P1].hand.find(id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(unitId).toBeDefined();

      // Put a unit on BF so subsequent units can be played there (BF control check)
      state.allCards[unitId!].location = 'battlefield';
      state.allCards[unitId!].battlefieldId = bfId;
      state.battlefields[0].units.push(unitId!);
      state.players[P1].hand = state.players[P1].hand.filter(id => id !== unitId);

      // Find another unit to play
      const nextUnitId = state.players[P1].hand.find(id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(nextUnitId).toBeDefined();

      // Set up state for action phase with enough mana
      const unitDef = state.cardDefinitions[state.allCards[nextUnitId!].cardId];
      const manaNeeded = unitDef.cost?.rune ?? 0;
      const playState: typeof state = {
        ...state,
        phase: 'FirstMain' as const,
        activePlayerId: P1,
        players: {
          ...state.players,
          [P1]: { ...state.players[P1], mana: manaNeeded + 5 },
        },
      };

      const action = makeAction('PlayUnit', P1, {
        cardInstanceId: nextUnitId!,
        battlefieldId: bfId,
        hidden: false,
        accelerate: false,
      });

      const result = executeAction(playState, action);

      expect(result.success).toBe(true);
      if (result.newState) {
        expect(result.newState.actionLog.length).toBeGreaterThan(0);
        // The action should be recorded in the log
        const loggedAction = result.newState.actionLog.find(log => log.id === action.id);
        expect(loggedAction).toBeDefined();
        expect(loggedAction!.type).toBe('PlayUnit');
      }
    });
  });

  describe('Pass action', () => {
    it('records Pass action in actionLog after successful execution', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const playState: typeof state = {
        ...state,
        phase: 'FirstMain' as const,
        activePlayerId: P1,
        players: {
          ...state.players,
          [P1]: { ...state.players[P1], mana: 5 },
        },
      };

      const action = makeAction('Pass', P1, {});
      const result = executeAction(playState, action);

      expect(result.success).toBe(true);
      if (result.newState) {
        expect(result.newState.actionLog.length).toBeGreaterThan(0);
        const loggedAction = result.newState.actionLog.find(log => log.id === action.id);
        expect(loggedAction).toBeDefined();
        expect(loggedAction!.type).toBe('Pass');
      }
    });
  });

  describe('Attack action', () => {
    it('records Attack action in actionLog after successful execution', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const bfId = state.battlefields[0].id;

      // Find a unit in hand and put it on battlefield
      const unitId = state.players[P1].hand.find(id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(unitId).toBeDefined();

      state.allCards[unitId!].location = 'battlefield';
      state.allCards[unitId!].battlefieldId = bfId;
      state.allCards[unitId!].ready = true;
      state.battlefields[0].units.push(unitId!);
      state.players[P1].hand = state.players[P1].hand.filter(id => id !== unitId);

      const playState: typeof state = {
        ...state,
        phase: 'FirstMain' as const,
        activePlayerId: P1,
        players: {
          ...state.players,
          [P1]: { ...state.players[P1], mana: 5 },
        },
      };

      const action = makeAction('Attack', P1, {
        attackerId: unitId!,
        targetBattlefieldId: bfId,
      });

      const result = executeAction(playState, action);

      expect(result.success).toBe(true);
      if (result.newState) {
        expect(result.newState.actionLog.length).toBeGreaterThan(0);
        const loggedAction = result.newState.actionLog.find(log => log.id === action.id);
        expect(loggedAction).toBeDefined();
        expect(loggedAction!.type).toBe('Attack');
      }
    });
  });

  describe('Concede action', () => {
    it('records Concede action in actionLog after successful execution', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      const playState: typeof state = {
        ...state,
        phase: 'FirstMain' as const,
        activePlayerId: P1,
      };

      const action = makeAction('Concede', P1, {});
      const result = executeAction(playState, action);

      expect(result.success).toBe(true);
      if (result.newState) {
        expect(result.newState.actionLog.length).toBeGreaterThan(0);
        const loggedAction = result.newState.actionLog.find(log => log.id === action.id);
        expect(loggedAction).toBeDefined();
        expect(loggedAction!.type).toBe('Concede');
      }
    });
  });

  describe('DrawRune action', () => {
    it('records DrawRune action in actionLog after successful execution', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const playState: typeof state = {
        ...state,
        phase: 'FirstMain' as const,
        activePlayerId: P1,
        players: {
          ...state.players,
          [P1]: { ...state.players[P1], mana: 5, charges: 1 },
        },
      };

      const action = makeAction('DrawRune', P1, {});
      const result = executeAction(playState, action);

      expect(result.success).toBe(true);
      if (result.newState) {
        expect(result.newState.actionLog.length).toBeGreaterThan(0);
        const loggedAction = result.newState.actionLog.find(log => log.id === action.id);
        expect(loggedAction).toBeDefined();
        expect(loggedAction!.type).toBe('DrawRune');
      }
    });
  });

  describe('UseRune action', () => {
    it('records UseRune action in actionLog after successful execution', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      // Give player a rune in hand
      const runeId = state.players[P1].runeDeck[0];
      state.allCards[runeId].location = 'hand';
      state.players[P1].hand.push(runeId);
      state.players[P1].runeDeck.shift();

      const playState: typeof state = {
        ...state,
        phase: 'FirstMain' as const,
        activePlayerId: P1,
        players: {
          ...state.players,
          [P1]: { ...state.players[P1], mana: 0 },
        },
      };

      const action = makeAction('UseRune', P1, {});
      const result = executeAction(playState, action);

      expect(result.success).toBe(true);
      if (result.newState) {
        expect(result.newState.actionLog.length).toBeGreaterThan(0);
        const loggedAction = result.newState.actionLog.find(log => log.id === action.id);
        expect(loggedAction).toBeDefined();
        expect(loggedAction!.type).toBe('UseRune');
      }
    });
  });

  describe('failed actions are not recorded', () => {
    it('does not record action in log when action fails (not your turn)', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const playState: typeof state = {
        ...state,
        phase: 'FirstMain' as const,
        activePlayerId: P1,
      };

      const initialLogLength = playState.actionLog.length;

      // Try to play a unit with P2 (not P1's turn)
      const action = makeAction('PlayUnit', P2, {
        cardInstanceId: 'nonexistent',
        battlefieldId: state.battlefields[0].id,
        hidden: false,
        accelerate: false,
      });

      const result = executeAction(playState, action);

      expect(result.success).toBe(false);
      if (result.newState) {
        // Action should NOT have been added to log
        const loggedAction = result.newState.actionLog.find(log => log.id === action.id);
        expect(loggedAction).toBeUndefined();
      }
    });
  });
});

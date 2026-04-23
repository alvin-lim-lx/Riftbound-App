/**
 * Phase Auto-Advance Tests — Issue #12
 *
 * The A-B-C-D phases (Awaken → Beginning → Channel → Draw) should advance
 * automatically unless there are effects on the stack (start-of-turn triggers)
 * that require player input.
 */

import {
  createGame,
  executeAction,
  advancePhase,
  enterPhase,
  canAutoAdvancePhase,
  deepClone,
} from '../src/engine/GameEngine';
import type { GameState, GameAction } from '../shared/src/types';

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

describe('Phase Auto-Advance (Issue #12)', () => {
  describe('canAutoAdvancePhase', () => {
    it('returns true for Awaken phase with empty stack', () => {
      const state: GameState = {
        ...createGame([P1, P2], ['Alice', 'Bob']),
        phase: 'Awaken',
        activePlayerId: P1,
        effectStack: [],
      };
      expect(canAutoAdvancePhase(state)).toBe(true);
    });

    it('returns true for Beginning phase with empty stack', () => {
      const state: GameState = {
        ...createGame([P1, P2], ['Alice', 'Bob']),
        phase: 'Beginning',
        activePlayerId: P1,
        effectStack: [],
      };
      expect(canAutoAdvancePhase(state)).toBe(true);
    });

    it('returns true for Channel phase with empty stack', () => {
      const state: GameState = {
        ...createGame([P1, P2], ['Alice', 'Bob']),
        phase: 'Channel',
        activePlayerId: P1,
        effectStack: [],
      };
      expect(canAutoAdvancePhase(state)).toBe(true);
    });

    it('returns true for Draw phase with empty stack', () => {
      const state: GameState = {
        ...createGame([P1, P2], ['Alice', 'Bob']),
        phase: 'Draw',
        activePlayerId: P1,
        effectStack: [],
      };
      expect(canAutoAdvancePhase(state)).toBe(true);
    });

    it('returns false for Beginning phase when effect stack is non-empty', () => {
      const state: GameState = {
        ...createGame([P1, P2], ['Alice', 'Bob']),
        phase: 'Beginning',
        activePlayerId: P1,
        effectStack: [
          {
            id: 'effect_1',
            sourceId: 'some_card',
            trigger: 'Start of Turn',
            effect: 'Draw a card',
            resolves: false,
          },
        ],
      };
      expect(canAutoAdvancePhase(state)).toBe(false);
    });

    it('returns false for Awaken phase when effect stack is non-empty', () => {
      const state: GameState = {
        ...createGame([P1, P2], ['Alice', 'Bob']),
        phase: 'Awaken',
        activePlayerId: P1,
        effectStack: [
          {
            id: 'effect_1',
            sourceId: 'some_battlefield',
            trigger: 'Start of Turn',
            effect: 'Ready all units',
            resolves: false,
          },
        ],
      };
      expect(canAutoAdvancePhase(state)).toBe(false);
    });

    it('returns false for non-A-B-C-D phases regardless of stack', () => {
      const phases: GameState['phase'][] = ['FirstMain', 'Combat', 'SecondMain', 'End', 'Action'];
      for (const phase of phases) {
        const state: GameState = {
          ...createGame([P1, P2], ['Alice', 'Bob']),
          phase,
          activePlayerId: P1,
          effectStack: [],
        };
        expect(canAutoAdvancePhase(state)).toBe(false);
      }
    });
  });

  describe('auto-advance sequence (Awaken → Beginning → Channel → Draw)', () => {
    it('advances Awaken → Beginning → Channel → Draw with empty stack without player input', () => {
      // Set up game state after Mulligan, at the start of a turn
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.phase = 'Awaken';
      state.activePlayerId = P1;
      state.turn = 1;
      state.effectStack = [];

      // Simulate the auto-advance sequence
      let current = state;
      const phasesVisited: GameState['phase'][] = [];

      // Awaken should auto-advance
      expect(canAutoAdvancePhase(current)).toBe(true);
      phasesVisited.push(current.phase);
      current = advancePhase(current);
      phasesVisited.push(current.phase);

      // Beginning should auto-advance
      expect(canAutoAdvancePhase(current)).toBe(true);
      current = advancePhase(current);
      phasesVisited.push(current.phase);

      // Channel should auto-advance
      expect(canAutoAdvancePhase(current)).toBe(true);
      current = advancePhase(current);
      phasesVisited.push(current.phase);

      // Draw should auto-advance
      expect(canAutoAdvancePhase(current)).toBe(true);
      current = advancePhase(current);
      phasesVisited.push(current.phase);

      // Should now be in Action phase
      expect(current.phase).toBe('Action');
      expect(phasesVisited).toEqual(['Awaken', 'Beginning', 'Channel', 'Draw', 'Action']);
    });

    it('blocks on Beginning phase when start-of-turn effect is on the stack', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.phase = 'Awaken';
      state.activePlayerId = P1;
      state.turn = 1;
      state.effectStack = [];

      // Awaken advances
      let current = advancePhase(state);
      expect(current.phase).toBe('Beginning');

      // Add a start-of-turn effect to the stack
      current.effectStack.push({
        id: 'effect_1',
        sourceId: 'some_card',
        trigger: 'Start of Turn',
        effect: 'You may draw a card',
        resolves: false,
      });

      // Beginning should NOT auto-advance when stack has pending effects
      expect(canAutoAdvancePhase(current)).toBe(false);
    });
  });

  describe('executeAwakenPhase', () => {
    it('ready all units at battlefields', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const bf = state.battlefields[0];

      // Put a unit on the battlefield
      const unitId = state.players[P1].hand[0];
      state.allCards[unitId].location = 'battlefield';
      state.allCards[unitId].battlefieldId = bf.id;
      state.allCards[unitId].exhausted = true;
      state.allCards[unitId].ready = false;
      bf.units.push(unitId);
      state.players[P1].hand = state.players[P1].hand.filter(id => id !== unitId);

      const newState = enterPhase(state, 'Awaken');

      // Unit should be ready after Awaken
      expect(newState.allCards[unitId].ready).toBe(true);
      expect(newState.allCards[unitId].exhausted).toBe(false);
    });

    it('resets mana and charges to 2 each', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.players[P1].mana = 0;
      state.players[P1].charges = 0;

      const newState = enterPhase(state, 'Awaken');

      expect(newState.players[P1].mana).toBe(2);
      expect(newState.players[P1].maxMana).toBe(2);
      expect(newState.players[P1].charges).toBe(1);
    });
  });

  describe('executeChannelPhase', () => {
    it('channels 2 runes from rune deck into rune pool', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.phase = 'Channel';
      state.activePlayerId = P1;

      const initialRuneDeckSize = state.players[P1].runeDeck.length;
      const newState = enterPhase(state, 'Channel');

      // 2 runes should have been moved from deck to rune pool
      const runePoolRunes = newState.players[P1].runeDeck.length;
      expect(runePoolRunes).toBe(initialRuneDeckSize - 2);

      // Those 2 should now be in the 'rune' location
      const runePool = Object.values(newState.allCards).filter(
        c => c.ownerId === P1 && c.location === 'rune'
      );
      expect(runePool.length).toBe(2);
    });
  });

  describe('executeDrawPhase', () => {
    it('draws 1 card from main deck', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.phase = 'Draw';
      state.activePlayerId = P1;

      const initialDeckSize = state.players[P1].deck.length;
      const initialHandSize = state.players[P1].hand.length;

      const newState = enterPhase(state, 'Draw');

      expect(newState.players[P1].deck.length).toBe(initialDeckSize - 1);
      expect(newState.players[P1].hand.length).toBe(initialHandSize + 1);
    });

    it('clears the rune pool after drawing', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.phase = 'Channel';
      state.activePlayerId = P1;

      // Channel some runes first
      const channeledState = enterPhase(state, 'Channel');

      // Verify runes are in pool
      const runesInPool = Object.values(channeledState.allCards).filter(
        c => c.ownerId === P1 && c.location === 'rune'
      );
      expect(runesInPool.length).toBe(2);

      // Now enter Draw phase
      const drawState: GameState = { ...channeledState, phase: 'Draw' };
      const newState = enterPhase(drawState, 'Draw');

      // Rune pool should be cleared
      const runesAfterDraw = Object.values(newState.allCards).filter(
        c => c.ownerId === P1 && c.location === 'rune'
      );
      expect(runesAfterDraw.length).toBe(0);
    });
  });
});

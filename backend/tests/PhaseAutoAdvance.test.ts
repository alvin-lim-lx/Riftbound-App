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
    phase: 'Action',
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

    it('does not let an impossible non-Beginning stack block Awaken auto-advance', () => {
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
      expect(canAutoAdvancePhase(state)).toBe(true);
    });

    it('returns false for non-A-B-C-D phases regardless of stack', () => {
      const phases: GameState['phase'][] = ['Action', 'End', 'Showdown', 'Scoring'];
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

      // Should now be in the real Action phase.
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

    it('adds in-play start-of-Beginning abilities to the stack and stops auto-advance', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.phase = 'Awaken';
      state.activePlayerId = P1;
      state.turn = 1;
      state.effectStack = [];

      const cardId = state.players[P1].hand[0];
      state.players[P1].hand = state.players[P1].hand.filter(id => id !== cardId);
      state.allCards[cardId].location = 'battlefield';
      state.allCards[cardId].battlefieldId = state.battlefields[0].id;
      state.battlefields[0].units.push(cardId);
      state.cardDefinitions[state.allCards[cardId].cardId] = {
        ...state.cardDefinitions[state.allCards[cardId].cardId],
        abilities: [
          {
            trigger: 'Start of Beginning Phase',
            effect: 'Draw a card.',
            effectCode: 'BEGINNING:DRAW_1',
          },
        ],
      };

      const beginningState = advancePhase(state);

      expect(beginningState.phase).toBe('Beginning');
      expect(beginningState.effectStack.length).toBe(1);
      expect(beginningState.effectStack[0].sourceId).toBe(cardId);
      expect(canAutoAdvancePhase(beginningState)).toBe(false);
    });
  });

  describe('executeAwakenPhase', () => {
    it('ready all units at battlefields', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
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

    it('readies active runes and clears floating energy', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.players[P1].floatingEnergy = 2;
      state.players[P1].charges = 0;
      const runeId = state.players[P1].runeDeck.shift()!;
      state.allCards[runeId].location = 'rune';
      state.allCards[runeId].exhausted = true;

      const newState = enterPhase(state, 'Awaken');

      expect(newState.allCards[runeId].exhausted).toBe(false);
      expect(newState.players[P1].floatingEnergy).toBe(0);
      expect(newState.players[P1].energy).toBe(1);
      expect(newState.players[P1].maxEnergy).toBe(1);
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

    it('channels 3 runes for the second player on their first turn', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.phase = 'Channel';
      state.activePlayerId = P2;
      state.turn = 2;
      state.players[P1].hasGoneFirst = true;
      state.players[P2].hasGoneFirst = false;

      const initialRuneDeckSize = state.players[P2].runeDeck.length;
      const newState = enterPhase(state, 'Channel');

      expect(newState.players[P2].runeDeck.length).toBe(initialRuneDeckSize - 3);
      const runePool = Object.values(newState.allCards).filter(
        c => c.ownerId === P2 && c.location === 'rune'
      );
      expect(runePool.length).toBe(3);
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

    it('keeps the rune pool after drawing', () => {
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

      // Rune pool should persist until runes are recycled for power.
      const runesAfterDraw = Object.values(newState.allCards).filter(
        c => c.ownerId === P1 && c.location === 'rune'
      );
      expect(runesAfterDraw.length).toBe(2);
    });
  });
});


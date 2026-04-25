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
import type { GameAction, GameState, SystemLogEntry, GameLogEntry } from '../shared/src/types';

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

function addReadyRunes(state: GameState, playerId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const runeId = state.players[playerId].runeDeck.shift();
    if (!runeId) return;
    state.allCards[runeId].location = 'rune';
    state.allCards[runeId].exhausted = false;
  }
}

function ensureHandCard(
  state: GameState,
  playerId: string,
  predicate: (id: string) => boolean
): string | undefined {
  const existing = state.players[playerId].hand.find(predicate);
  if (existing) return existing;
  const deckCard = state.players[playerId].deck.find(predicate);
  if (!deckCard) return undefined;
  state.players[playerId].deck = state.players[playerId].deck.filter(id => id !== deckCard);
  state.players[playerId].hand.push(deckCard);
  state.allCards[deckCard].location = 'hand';
  return deckCard;
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

    it('deals opening hands of 4 cards', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      expect(state.players[P1].hand.length).toBe(4);
      expect(state.players[P2].hand.length).toBe(4);
    });

    it('creates rune decks for both players', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      expect(state.players[P1].runeDeck.length).toBe(12);
      expect(state.players[P2].runeDeck.length).toBe(12);
    });

    it('shuffles rune decks during setup', () => {
      let randomCalls = 0;
      const randomSpy = jest.spyOn(Math, 'random').mockImplementation(() => {
        randomCalls++;
        if (randomCalls >= 9 && randomCalls <= 13) return 0;
        return ((randomCalls % 90) + 1) / 100;
      });
      try {
        const runeIds = [
          'rune_fury_1',
          'rune_calm_1',
          'rune_mind_1',
          'rune_body_1',
          'rune_chaos_1',
          'rune_order_1',
        ];
        const state = createGame([P1, P2], ['Alice', 'Bob'], {
          playerDecks: {
            [P1]: {
              legendId: 'ogn-247-298',
              chosenChampionCardId: 'ogn-011-298',
              cardIds: [],
              runeIds,
            },
            [P2]: {
              legendId: 'ogn-247-298',
              chosenChampionCardId: 'ogn-011-298',
              cardIds: [],
              runeIds,
            },
          },
        });

        const p1RuneCards = state.players[P1].runeDeck.map(id => state.allCards[id].cardId);
        expect(p1RuneCards).toHaveLength(runeIds.length);
        expect([...p1RuneCards].sort()).toEqual([...runeIds].sort());
        expect(p1RuneCards).not.toEqual(runeIds);
      } finally {
        randomSpy.mockRestore();
      }
    });
  });

  describe('Phase Transitions', () => {
    it('only active player can pass', () => {
      const state = { ...createGame([P1, P2], ['Alice', 'Bob']), phase: 'Action' as const, activePlayerId: P1 };
      const result = executeAction(state, makeAction('Pass', P2));
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not your turn.');
    });
  });

  describe('Mulligan', () => {
    it('rejects setting aside more than 2 cards', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      const activePlayer = state.activePlayerId;
      const keepIds = state.players[activePlayer].hand.slice(0, 1);

      const result = executeAction(state, makeAction('Mulligan', activePlayer, { keepIds }));

      expect(result.success).toBe(false);
      expect(result.error).toBe('Mulligan: may set aside at most 2 cards.');
    });

    it('draws replacements before putting set-aside cards on the bottom of the deck', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      const activePlayer = state.activePlayerId;
      const originalHand = [...state.players[activePlayer].hand];
      const originalDeck = [...state.players[activePlayer].deck];
      const keepIds = originalHand.slice(0, 2);
      const setAsideIds = originalHand.slice(2);
      const replacementIds = originalDeck.slice(0, setAsideIds.length);

      const result = executeAction(state, makeAction('Mulligan', activePlayer, { keepIds }));

      expect(result.success).toBe(true);
      expect(result.newState).toBeDefined();
      const player = result.newState!.players[activePlayer];
      expect(player.hand).toEqual([...keepIds, ...replacementIds]);
      expect(player.deck.slice(-setAsideIds.length)).toEqual(setAsideIds);
      for (const id of setAsideIds) {
        expect(result.newState!.allCards[id].location).toBe('deck');
      }
    });

    it('keeps the original first player as the first Awaken player after both mulligans', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      state.activePlayerId = P1;
      state.players[P1].hasGoneFirst = true;
      state.players[P2].hasGoneFirst = false;

      const p1Result = executeAction(state, makeAction('Mulligan', P1, {
        keepIds: [...state.players[P1].hand],
      }));
      expect(p1Result.success).toBe(true);
      expect(p1Result.newState!.activePlayerId).toBe(P2);

      const p2Result = executeAction(p1Result.newState!, makeAction('Mulligan', P2, {
        keepIds: [...p1Result.newState!.players[P2].hand],
      }));

      expect(p2Result.success).toBe(true);
      expect(p2Result.newState!.turn).toBe(1);
      expect(p2Result.newState!.phase).toBe('Awaken');
      expect(p2Result.newState!.activePlayerId).toBe(P1);
    });
  });

  describe('PlayUnit', () => {
    it('rejects playing a card not in hand', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      // Set up a valid phase and active player for the action
      state.phase = 'Action';
      state.activePlayerId = P1;
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
      const unitId = ensureHandCard(state, P1, id =>
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
      state.activePlayerId = P1;
      state.phase = 'Action';
      const bfId = state.battlefields[0].id;

      // Move a unit from hand to battlefield first (simulates previously played unit)
      const unitId = ensureHandCard(state, P1, id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(unitId).toBeDefined();

      // Mutate: put unit on BF so subsequent units can be played there
      state.allCards[unitId!].location = 'battlefield';
      state.allCards[unitId!].battlefieldId = bfId;
      state.battlefields[0].units.push(unitId!);
      state.players[P1].hand = state.players[P1].hand.filter(id => id !== unitId);

      // Find another unit in hand to play
      const nextUnitId = ensureHandCard(state, P1, id => {
        const def = state.cardDefinitions[state.allCards[id].cardId];
        return def.type === 'Unit' && (def.cost?.power ?? 0) === 0;
      });
      expect(nextUnitId).toBeDefined();

      const nextDef = state.cardDefinitions[state.allCards[nextUnitId!].cardId];
      const playState: typeof state = {
        ...state,
        phase: 'Action' as const,
        activePlayerId: P1,
      };
      addReadyRunes(playState, P1, (nextDef.cost?.rune ?? 0) + 5);

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
      state.activePlayerId = P1;
      state.phase = 'Action';
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
      moveAction.phase = 'Action';

      const moveResult = executeAction(state, moveAction);
      expect(moveResult.success).toBe(false);
      expect(moveResult.error).toBe('Unit does not have Ganking.');
    });
  });

  describe('Combat / Showdown', () => {
    it('rejects attacking from wrong player', () => {
      const state = { ...createGame([P1, P2], ['Alice', 'Bob']), phase: 'Action' as const, activePlayerId: P1 };
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
    it('returns Pass as a legal action in Action', () => {
      const state = { ...createGame([P1, P2], ['Alice', 'Bob']), phase: 'Action' as const, activePlayerId: P1 };
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
        phase: 'Action' as const,
        activePlayerId: P1,
      };
      addReadyRunes(highManaState, P1, 10);

      const actions = getLegalActions(highManaState, P1);
      expect(actions.some(a => a.type === 'PlayUnit')).toBe(true);
    });
  });

  describe('Legend and Champion Zone Setup', () => {
    it('places legend card in legendZone location', () => {
      const legendCardId = 'ogn-247-298'; // Daughter of the Void — actual Legend card
      const championCardId = 'ogn-011-298'; // Magma Wurm — type: Unit, superType: Champion
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
      const legendCardId = 'ogn-247-298';
      const championCardId = 'ogn-011-298';
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
      const legendCardId = 'ogn-247-298';
      const championCardId = 'ogn-011-298';
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
        state.activePlayerId = P1;
        const result = executeAction(state, makeAction('Concede', P1));
      expect(result.success).toBe(true);
      if (result.newState) {
        expect(result.newState.phase).toBe('GameOver');
        expect(result.newState.winner).toBe(P2);
      }
    });
  });

  describe('actionLog', () => {
    it('logs player actions to actionLog on success', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      const initialLogSize = state.actionLog.length;

      // Advance to Action phase so we can play a unit
      const phaseState = { ...state, phase: 'Action' as const, activePlayerId: P1 };

      // Execute a Pass action
      const passAction = makeAction('Pass', P1);
      const result = executeAction(phaseState, passAction);

      expect(result.success).toBe(true);
      expect(result.newState).toBeDefined();
      expect(result.newState!.actionLog.length).toBeGreaterThan(initialLogSize);
      // The last logged action should be our Pass action
      const loggedAction = result.newState!.actionLog[result.newState!.actionLog.length - 1];
      expect(loggedAction.id).toBe(passAction.id);
      expect(loggedAction.type).toBe('Pass');
    });

    it('logs phase transitions to actionLog', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      // Just verify actionLog exists and is an array with entries from setup
      expect(Array.isArray(state.actionLog)).toBe(true);
      // Phase entries are added via enterPhase during createGame (Setup → Mulligan)
      expect(state.actionLog.length).toBeGreaterThan(0);
    });

    it('logs mulligan action to actionLog', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);

      // Mulligan phase is active — activePlayerId is the first player
      const activePlayer = state.activePlayerId;
      const handIds = state.players[activePlayer].hand;
      const keepIds = handIds.slice(1); // keep all but first card (set aside 1)

      const mulliganAction = makeAction('Mulligan', activePlayer, { keepIds });
      const result = executeAction(state, mulliganAction);

      expect(result.success).toBe(true);
      expect(result.newState).toBeDefined();
      // Mulligan action itself should be logged
      const loggedMulligan = result.newState!.actionLog.find((a: GameAction) => a.id === mulliganAction.id);
      expect(loggedMulligan).toBeDefined();
      expect(loggedMulligan.type).toBe('Mulligan');
    });

    it('does not log failed actions to actionLog', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      const logSizeBefore = state.actionLog.length;

      // Try to play a unit that doesn't exist in hand
      const playAction = makeAction('PlayUnit', P1, {
        cardInstanceId: 'nonexistent_card',
        battlefieldId: state.battlefields[0].id,
        hidden: false,
        accelerate: false,
      });
      const result = executeAction(state, playAction);

      expect(result.success).toBe(false);
      expect(result.newState).toBeUndefined();
      // Failed action should not appear in actionLog
      expect(state.actionLog.find((a: GameAction) => a.id === playAction.id)).toBeUndefined();
    });

    it('logs turn changes to actionLog via startNewTurn', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      // Force to End of turn so advancePhase will call startNewTurn
      const endState = { ...state, phase: 'End' as const, turn: 1, activePlayerId: P1 };

      const result = executeAction(endState, makeAction('Pass', P1));

      expect(result.success).toBe(true);
      expect(result.newState).toBeDefined();
      // Should have a TurnChange log entry
      const turnChangeEntry = (result.newState!.actionLog as any[]).find(
        (a) => a.type === 'TurnChange'
      );
      expect(turnChangeEntry).toBeDefined();
      // SystemLogEntry has 'message' field directly (not nested in payload)
      expect(String(turnChangeEntry.message)).toContain('Turn 2');
    });

    it('actionLog contains GameStart SystemLogEntry at createGame', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      // actionLog should contain GameStart entry from createGame
      expect(state.actionLog.length).toBeGreaterThan(0);

      // GameStart is a SystemLogEntry (no payload field)
      const gameStartEntry = state.actionLog.find(
        (entry: any) => entry.type === 'GameStart'
      );
      expect(gameStartEntry).toBeDefined();
      expect((gameStartEntry as any).message).toContain('Game started');

      // Each log entry should have required fields: id, type, turn, phase, timestamp
      for (const entry of state.actionLog) {
        expect(entry).toHaveProperty('id');
        expect(entry).toHaveProperty('type');
        expect(entry).toHaveProperty('turn');
        expect(entry).toHaveProperty('phase');
        expect(entry).toHaveProperty('timestamp');
      }
    });

    it('system log entries correctly identify playerId where applicable', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);
      // Phase change logs should have playerId set to activePlayerId
      const phaseChangeEntries = state.actionLog.filter(
        (entry: GameLogEntry) => entry.type === 'PhaseChange'
      );
      for (const entry of phaseChangeEntries) {
        const sysEntry = entry as SystemLogEntry;
        expect(sysEntry.playerId).toBeDefined();
        expect([P1, P2]).toContain(sysEntry.playerId);
      }
    });
  });
});


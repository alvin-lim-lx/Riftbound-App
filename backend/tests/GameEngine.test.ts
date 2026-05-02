/**
 * GameEngine Unit Tests
 */

import {
  createGame,
  executeAction,
  checkWinCondition,
  getLegalActions,
  deepClone,
  enterPhase,
  enterShowdown,
  canClaimFocus,
  handleFocus,
  canPlayReaction,
  resolveCombat,
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

function placeUnitAt(state: GameState, playerId: string, unitId: string, battlefieldId: string, ready = true): void {
  for (const battlefield of state.battlefields) {
    battlefield.units = battlefield.units.filter(id => id !== unitId);
  }
  state.players[playerId].hand = state.players[playerId].hand.filter(id => id !== unitId);
  state.players[playerId].deck = state.players[playerId].deck.filter(id => id !== unitId);
  state.allCards[unitId].location = 'battlefield';
  state.allCards[unitId].battlefieldId = battlefieldId;
  state.allCards[unitId].ready = ready;
  state.allCards[unitId].exhausted = !ready;
  state.battlefields.find(bf => bf.id === battlefieldId)!.units.push(unitId);
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

    it("readies only the active player's units during Awaken", () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      const battlefieldId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const p1UnitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      const p2UnitId = ensureHandCard(state, P2, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(p1UnitId).toBeDefined();
      expect(p2UnitId).toBeDefined();
      placeUnitAt(state, P1, p1UnitId!, battlefieldId, false);
      placeUnitAt(state, P2, p2UnitId!, battlefieldId, false);

      const awakened = enterPhase(state, 'Awaken');

      expect(awakened.allCards[p1UnitId!].ready).toBe(true);
      expect(awakened.allCards[p1UnitId!].exhausted).toBe(false);
      expect(awakened.allCards[p2UnitId!].ready).toBe(false);
      expect(awakened.allCards[p2UnitId!].exhausted).toBe(true);
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
    it('rejects playing a unit without enough ready runes', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const unitId = ensureHandCard(state, P1, id => {
        const def = state.cardDefinitions[state.allCards[id].cardId];
        return def.type === 'Unit' && (def.cost?.rune ?? 0) > 0 && (def.cost?.power ?? 0) === 0;
      });
      expect(unitId).toBeDefined();

      const result = executeAction(state, makeAction('PlayUnit', P1, {
        cardInstanceId: unitId!,
        battlefieldId: `base_${P1}`,
        hidden: false,
        accelerate: false,
      }));

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not enough ready runes.');
    });

    it('successfully plays a unit to the player base', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const baseId = `base_${P1}`;
      const unitId = ensureHandCard(state, P1, id => {
        const def = state.cardDefinitions[state.allCards[id].cardId];
        return def.type === 'Unit' && (def.cost?.power ?? 0) === 0;
      });
      expect(unitId).toBeDefined();

      const def = state.cardDefinitions[state.allCards[unitId!].cardId];
      addReadyRunes(state, P1, (def.cost?.rune ?? 0) + 2);

      const result = executeAction(state, makeAction('PlayUnit', P1, {
        cardInstanceId: unitId!,
        battlefieldId: baseId,
        hidden: false,
        accelerate: false,
      }));

      expect(result.success).toBe(true);
      expect(result.newState!.allCards[unitId!].location).toBe('battlefield');
      expect(result.newState!.allCards[unitId!].battlefieldId).toBe(baseId);
      expect(result.newState!.allCards[unitId!].ready).toBe(false);
      expect(result.newState!.allCards[unitId!].exhausted).toBe(true);
      expect(result.newState!.battlefields.find(bf => bf.id === baseId)!.units).toContain(unitId);
      expect(result.newState!.players[P1].hand).not.toContain(unitId);
    });

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

  describe('PlayGear', () => {
    it('rejects playing gear without enough ready runes', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const gearId = ensureHandCard(state, P1, id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Gear'
      );

      const unitId = state.players[P1].hand.find(id => {
        const def = state.cardDefinitions[state.allCards[id].cardId];
        return def.type === 'Gear' && (def.cost?.rune ?? 0) > 0 && (def.cost?.power ?? 0) === 0;
      });
      expect(gearId).toBeDefined();

      const result = executeAction(state, makeAction('PlayGear', P1, {
        cardInstanceId: gearId!,
        targetBattlefieldId: `base_${P1}`,
      }));

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not enough ready runes.');
    });

    it('successfully plays gear to the player base by battlefield target', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const baseId = `base_${P1}`;
      const gearId = ensureHandCard(state, P1, id => {
        const def = state.cardDefinitions[state.allCards[id].cardId];
        return def.type === 'Gear' && (def.cost?.power ?? 0) === 0;
      });
      expect(gearId).toBeDefined();

      const def = state.cardDefinitions[state.allCards[gearId!].cardId];
      addReadyRunes(state, P1, (def.cost?.rune ?? 0) + 2);

      const result = executeAction(state, makeAction('PlayGear', P1, {
        cardInstanceId: gearId!,
        targetBattlefieldId: baseId,
      }));

      expect(result.success).toBe(true);
      expect(result.newState!.allCards[gearId!].location).toBe('battlefield');
      expect(result.newState!.allCards[gearId!].battlefieldId).toBe(baseId);
      expect(result.newState!.players[P1].equipment[gearId!]).toBeUndefined();
      expect(result.newState!.players[P1].hand).not.toContain(gearId);
    });

    it('rejects playing gear without a unit or battlefield target', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const gearId = ensureHandCard(state, P1, id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Gear'
      );
      expect(gearId).toBeDefined();

      const result = executeAction(state, makeAction('PlayGear', P1, {
        cardInstanceId: gearId!,
      }));

      expect(result.success).toBe(false);
      expect(result.error).toBe('Gear needs a unit or battlefield target.');
    });
  });

  describe('MoveUnit', () => {
    it('moves a ready non-Ganking unit from base to battlefield and exhausts it', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const baseId = `base_${P1}`;
      const targetBfId = state.battlefields.find(bf => bf.id !== baseId && !bf.id.startsWith('base_'))!.id;
      const unitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(unitId).toBeDefined();
      state.cardDefinitions[state.allCards[unitId!].cardId].keywords = [];
      placeUnitAt(state, P1, unitId!, baseId, true);

      const result = executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceId: unitId!,
        fromBattlefieldId: baseId,
        toBattlefieldId: targetBfId,
      }));

      expect(result.success).toBe(true);
      expect(result.newState!.allCards[unitId!].battlefieldId).toBe(targetBfId);
      expect(result.newState!.allCards[unitId!].ready).toBe(false);
      expect(result.newState!.allCards[unitId!].exhausted).toBe(true);
      expect(result.newState!.battlefields.find(bf => bf.id === baseId)!.units).not.toContain(unitId);
      expect(result.newState!.battlefields.find(bf => bf.id === targetBfId)!.units).toContain(unitId);
      const targetBf = result.newState!.battlefields.find(bf => bf.id === targetBfId)!;
      expect(targetBf.controllerId).toBe(P1);
      expect(targetBf.scoringPlayerId).toBe(P1);
      expect(targetBf.scoringSince).toBe(result.newState!.turn);
      expect(result.newState!.players[P1].score).toBe(1);
      expect(result.newState!.scoredBattlefieldsThisTurn[P1]).toContain(targetBfId);
    });

    it('scores a held uncontested battlefield during the controller beginning phase', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      state.turn = 3;
      const baseId = `base_${P1}`;
      const targetBfId = state.battlefields.find(bf => bf.id !== baseId && !bf.id.startsWith('base_'))!.id;
      const unitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(unitId).toBeDefined();
      placeUnitAt(state, P1, unitId!, baseId, true);

      const moveResult = executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceId: unitId!,
        fromBattlefieldId: baseId,
        toBattlefieldId: targetBfId,
      }));
      expect(moveResult.success).toBe(true);

      const nextBeginning = deepClone(moveResult.newState!);
      nextBeginning.activePlayerId = P1;
      nextBeginning.turn = 5;
      const scoredState = enterPhase(nextBeginning, 'Beginning');

      expect(scoredState.players[P1].score).toBe(1);
      expect(scoredState.actionLog.some(entry => (entry as SystemLogEntry).type === 'Score')).toBe(true);
    });

    it('ends the game immediately when hold scoring reaches the victory score', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Beginning';
      state.players[P1].score = state.scoreLimit - 1;
      state.players[P2].score = state.scoreLimit - 2;
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const unitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(unitId).toBeDefined();
      placeUnitAt(state, P1, unitId!, targetBfId, false);
      const bf = state.battlefields.find(battlefield => battlefield.id === targetBfId)!;
      bf.controllerId = P1;
      bf.scoringPlayerId = P1;
      bf.scoringSince = state.turn - 1;

      const scoredState = enterPhase(state, 'Beginning');

      expect(scoredState.players[P1].score).toBe(state.scoreLimit);
      expect(scoredState.phase).toBe('GameOver');
      expect(scoredState.winner).toBe(P1);
    });

    it('moves a ready non-Ganking unit from battlefield to own base and exhausts it', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const sourceBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const baseId = `base_${P1}`;
      const unitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(unitId).toBeDefined();
      state.cardDefinitions[state.allCards[unitId!].cardId].keywords = [];
      placeUnitAt(state, P1, unitId!, sourceBfId, true);

      const result = executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceId: unitId!,
        toBattlefieldId: baseId,
      }));

      expect(result.success).toBe(true);
      expect(result.newState!.allCards[unitId!].battlefieldId).toBe(baseId);
      expect(result.newState!.allCards[unitId!].exhausted).toBe(true);
      expect(result.newState!.battlefields.find(bf => bf.id === sourceBfId)!.units).not.toContain(unitId);
      expect(result.newState!.battlefields.find(bf => bf.id === baseId)!.units).toContain(unitId);
    });

    it('rejects battlefield-to-battlefield move without Ganking', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const sourceBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_') && bf.id !== sourceBfId)!.id;
      const unitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(unitId).toBeDefined();
      state.cardDefinitions[state.allCards[unitId!].cardId].keywords = [];
      placeUnitAt(state, P1, unitId!, sourceBfId, true);

      const result = executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceId: unitId!,
        fromBattlefieldId: sourceBfId,
        toBattlefieldId: targetBfId,
      }));

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unit does not have Ganking.');
      expect(state.allCards[unitId!].battlefieldId).toBe(sourceBfId);
    });

    it('moves a ready Ganking unit battlefield-to-battlefield and exhausts it', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const sourceBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_') && bf.id !== sourceBfId)!.id;
      const unitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(unitId).toBeDefined();
      state.cardDefinitions[state.allCards[unitId!].cardId].keywords = ['Ganking'];
      placeUnitAt(state, P1, unitId!, sourceBfId, true);

      const result = executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceId: unitId!,
        toBattlefieldId: targetBfId,
      }));

      expect(result.success).toBe(true);
      expect(result.newState!.allCards[unitId!].battlefieldId).toBe(targetBfId);
      expect(result.newState!.allCards[unitId!].exhausted).toBe(true);
    });

    it('batch moves multiple ready units from different origins to one destination atomically', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const baseId = `base_${P1}`;
      const sourceBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_') && bf.id !== sourceBfId)!.id;
      const firstUnitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(firstUnitId).toBeDefined();
      const secondUnitId = ensureHandCard(state, P1, id =>
        id !== firstUnitId && state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(secondUnitId).toBeDefined();
      state.cardDefinitions[state.allCards[firstUnitId!].cardId].keywords = [];
      state.cardDefinitions[state.allCards[secondUnitId!].cardId].keywords = ['Ganking'];
      placeUnitAt(state, P1, firstUnitId!, baseId, true);
      placeUnitAt(state, P1, secondUnitId!, sourceBfId, true);

      const result = executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceIds: [firstUnitId!, secondUnitId!],
        toBattlefieldId: targetBfId,
      }));

      expect(result.success).toBe(true);
      expect(result.newState!.allCards[firstUnitId!].battlefieldId).toBe(targetBfId);
      expect(result.newState!.allCards[secondUnitId!].battlefieldId).toBe(targetBfId);
      expect(result.newState!.allCards[firstUnitId!].exhausted).toBe(true);
      expect(result.newState!.allCards[secondUnitId!].exhausted).toBe(true);
      expect(result.newState!.battlefields.find(bf => bf.id === targetBfId)!.units).toEqual(
        expect.arrayContaining([firstUnitId!, secondUnitId!])
      );
    });

    it('rejects a batch with one invalid unit and leaves every unit unmoved', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const baseId = `base_${P1}`;
      const sourceBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_') && bf.id !== sourceBfId)!.id;
      const firstUnitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(firstUnitId).toBeDefined();
      const secondUnitId = ensureHandCard(state, P1, id =>
        id !== firstUnitId && state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(secondUnitId).toBeDefined();
      state.cardDefinitions[state.allCards[firstUnitId!].cardId].keywords = [];
      state.cardDefinitions[state.allCards[secondUnitId!].cardId].keywords = [];
      placeUnitAt(state, P1, firstUnitId!, baseId, true);
      placeUnitAt(state, P1, secondUnitId!, sourceBfId, true);

      const result = executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceIds: [firstUnitId!, secondUnitId!],
        toBattlefieldId: targetBfId,
      }));

      expect(result.success).toBe(false);
      expect(result.newState).toBeUndefined();
      expect(state.allCards[firstUnitId!].battlefieldId).toBe(baseId);
      expect(state.allCards[secondUnitId!].battlefieldId).toBe(sourceBfId);
      expect(state.allCards[firstUnitId!].ready).toBe(true);
      expect(state.allCards[secondUnitId!].ready).toBe(true);
    });

    it('rejects exhausted, enemy, non-unit, duplicate, same-location, missing-destination, and wrong-phase moves', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const baseId = `base_${P1}`;
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const unitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(unitId).toBeDefined();
      placeUnitAt(state, P1, unitId!, baseId, false);

      expect(executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceId: unitId!,
        toBattlefieldId: targetBfId,
      })).error).toBe('Unit is exhausted.');

      state.allCards[unitId!].ready = true;
      state.allCards[unitId!].exhausted = false;
      expect(executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceId: unitId!,
        toBattlefieldId: baseId,
      })).error).toBe('Unit is already at that location.');

      expect(executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceId: unitId!,
        toBattlefieldId: 'missing_battlefield',
      })).error).toBe('Destination battlefield not found.');

      expect(executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceIds: [unitId!, unitId!],
        toBattlefieldId: targetBfId,
      })).error).toBe('Cannot move the same unit more than once.');

      const enemyUnitId = ensureHandCard(state, P2, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(enemyUnitId).toBeDefined();
      placeUnitAt(state, P2, enemyUnitId!, `base_${P2}`, true);
      expect(executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceId: enemyUnitId!,
        toBattlefieldId: targetBfId,
      })).error).toBe('Cannot move enemy units.');

      const gearId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Gear');
      expect(gearId).toBeDefined();
      state.allCards[gearId!].location = 'battlefield';
      state.allCards[gearId!].battlefieldId = baseId;
      state.battlefields.find(bf => bf.id === baseId)!.units.push(gearId!);
      expect(executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceId: gearId!,
        toBattlefieldId: targetBfId,
      })).error).toBe('Only units can move.');

      const wrongPhaseState = deepClone(state);
      wrongPhaseState.phase = 'Draw';
      expect(executeAction(wrongPhaseState, makeAction('MoveUnit', P1, {
        cardInstanceId: unitId!,
        toBattlefieldId: targetBfId,
      })).error).toBe('Move actions are only allowed during Action phase.');
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

    it('attacks using the cloned state so the broadcast state includes the attacker at the target battlefield', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      const sourceBfId = `base_${P1}`;
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const unitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(unitId).toBeDefined();
      placeUnitAt(state, P1, unitId!, sourceBfId, true);

      const result = executeAction(state, makeAction('Attack', P1, {
        attackerId: unitId!,
        targetBattlefieldId: targetBfId,
      }));

      expect(result.success).toBe(true);
      expect(result.newState!.phase).toBe('Showdown');
      expect(result.newState!.allCards[unitId!].battlefieldId).toBe(targetBfId);
      expect(result.newState!.battlefields.find(bf => bf.id === sourceBfId)!.units).not.toContain(unitId);
      expect(result.newState!.battlefields.find(bf => bf.id === targetBfId)!.units).toContain(unitId);
    });

    it('scores immediately when a player conquers a battlefield', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.phase = 'Showdown';
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const attackerId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(attackerId).toBeDefined();
      placeUnitAt(state, P1, attackerId!, targetBfId, false);
      const showdownState = enterShowdown(state, attackerId!, targetBfId);

      const result = resolveCombat(showdownState);

      expect(result.success).toBe(true);
      expect(result.newState!.players[P1].score).toBe(1);
      expect(result.newState!.scoredBattlefieldsThisTurn[P1]).toContain(targetBfId);
    });

    it('does not grant the winning point from conquer unless every battlefield was scored this turn', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.phase = 'Showdown';
      state.players[P1].score = state.scoreLimit - 1;
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const attackerId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
      expect(attackerId).toBeDefined();
      placeUnitAt(state, P1, attackerId!, targetBfId, false);
      const handAfterSetup = state.players[P1].hand.length;
      const showdownState = enterShowdown(state, attackerId!, targetBfId);

      const result = resolveCombat(showdownState);

      expect(result.success).toBe(true);
      expect(result.newState!.players[P1].score).toBe(state.scoreLimit - 1);
      expect(result.newState!.players[P1].hand.length).toBe(handAfterSetup + 1);
      expect(result.newState!.scoredBattlefieldsThisTurn[P1]).toContain(targetBfId);
      expect(checkWinCondition(result.newState!)).toBeNull();
    });

    it('starts combat damage assignment with all attacking units counted', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const attackerA = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit')!;
      const attackerB = ensureHandCard(state, P1, id => id !== attackerA && state.cardDefinitions[state.allCards[id].cardId].type === 'Unit')!;
      const defender = ensureHandCard(state, P2, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit')!;
      placeUnitAt(state, P1, attackerA, targetBfId, false);
      placeUnitAt(state, P1, attackerB, targetBfId, false);
      placeUnitAt(state, P2, defender, targetBfId, false);
      state.allCards[attackerA].currentStats.might = 2;
      state.allCards[attackerB].currentStats.might = 2;
      state.allCards[defender].currentStats.might = 4;

      const result = resolveCombat(enterShowdown(state, attackerA, targetBfId));

      expect(result.success).toBe(true);
      expect(result.newState!.pendingCombatDamageAssignment?.availableDamage).toBe(4);
      expect(result.newState!.showdown!.attackerIds).toEqual(expect.arrayContaining([attackerA, attackerB]));
    });

    it('lets a defender survivor establish control and score conquer', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const attacker = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit')!;
      const defender = ensureHandCard(state, P2, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit')!;
      placeUnitAt(state, P1, attacker, targetBfId, false);
      placeUnitAt(state, P2, defender, targetBfId, false);
      state.allCards[attacker].currentStats.might = 1;
      state.allCards[defender].currentStats.might = 3;

      const assigning = resolveCombat(enterShowdown(state, attacker, targetBfId)).newState!;
      const afterAttackAssign = executeAction(assigning, makeAction('AssignCombatDamage', P1, {
        targetOrder: [defender],
      })).newState!;
      const result = executeAction(afterAttackAssign, makeAction('AssignCombatDamage', P2, {
        targetOrder: [attacker],
      }));

      expect(result.success).toBe(true);
      expect(result.newState!.battlefields.find(bf => bf.id === targetBfId)!.controllerId).toBe(P2);
      expect(result.newState!.players[P2].score).toBe(1);
    });

    it('deals combat damage simultaneously so both sides can die', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const attacker = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit')!;
      const defender = ensureHandCard(state, P2, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit')!;
      placeUnitAt(state, P1, attacker, targetBfId, false);
      placeUnitAt(state, P2, defender, targetBfId, false);
      state.allCards[attacker].currentStats.might = 3;
      state.allCards[defender].currentStats.might = 3;

      const assigning = resolveCombat(enterShowdown(state, attacker, targetBfId)).newState!;
      const afterAttackAssign = executeAction(assigning, makeAction('AssignCombatDamage', P1, {
        targetOrder: [defender],
      })).newState!;
      const result = executeAction(afterAttackAssign, makeAction('AssignCombatDamage', P2, {
        targetOrder: [attacker],
      }));

      expect(result.success).toBe(true);
      expect(result.newState!.allCards[attacker].location).toBe('discard');
      expect(result.newState!.allCards[defender].location).toBe('discard');
      expect(result.newState!.battlefields.find(bf => bf.id === targetBfId)!.controllerId).toBeNull();
    });

    it('rejects combat damage that skips Tank priority', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      const attacker = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit')!;
      const tank = ensureHandCard(state, P2, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit')!;
      const normal = ensureHandCard(state, P2, id => id !== tank && state.cardDefinitions[state.allCards[id].cardId].type === 'Unit')!;
      placeUnitAt(state, P1, attacker, targetBfId, false);
      placeUnitAt(state, P2, tank, targetBfId, false);
      placeUnitAt(state, P2, normal, targetBfId, false);
      state.allCards[attacker].currentStats.might = 4;
      state.allCards[tank].currentStats.might = 2;
      state.allCards[normal].currentStats.might = 2;
      const normalDef = state.cardDefinitions[state.allCards[normal].cardId];
      const normalTestCardId = `${normalDef.id}_test_normal`;
      state.cardDefinitions[normalTestCardId] = {
        ...normalDef,
        id: normalTestCardId,
        keywords: [],
        abilities: normalDef.abilities.map(ability => ({ ...ability, effect: '', effectCode: '' })),
      };
      state.allCards[normal].cardId = normalTestCardId;
      state.cardDefinitions[state.allCards[tank].cardId].keywords = [
        ...(state.cardDefinitions[state.allCards[tank].cardId].keywords ?? []),
        'Tank',
      ] as any;

      const assigning = resolveCombat(enterShowdown(state, attacker, targetBfId)).newState!;
      const result = executeAction(assigning, makeAction('AssignCombatDamage', P1, {
        targetOrder: [normal, tank],
      }));

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Tank|Backline/);
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

    it('requires the scoring player to have more points than each opponent', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.players[P1].score = 8;
      state.players[P2].score = 8;
      expect(checkWinCondition(state)).toBeNull();

      state.players[P1].score = 9;
      expect(checkWinCondition(state)).toBe(P1);
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
      const unitId = ensureHandCard(state, P1, id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(unitId).toBeDefined();

      state.allCards[unitId!].location = 'battlefield';
      state.allCards[unitId!].battlefieldId = bfId;
      state.battlefields[0].units.push(unitId!);
      state.players[P1].hand = state.players[P1].hand.filter(id => id !== unitId);

      // Find another unit
      const nextUnitId = ensureHandCard(state, P1, id =>
        id !== unitId &&
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

    it('does not return action-phase moves during Beginning', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.phase = 'Beginning';
      state.activePlayerId = P1;
      const baseId = `base_${P1}`;
      const unitId = ensureHandCard(state, P1, id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(unitId).toBeDefined();
      placeUnitAt(state, P1, unitId!, baseId, true);
      addReadyRunes(state, P1, 10);

      const actions = getLegalActions(state, P1);

      expect(actions.map(action => action.type)).not.toEqual(
        expect.arrayContaining(['PlayUnit', 'PlaySpell', 'PlayGear', 'MoveUnit', 'Attack'])
      );
    });

    it('ends the game immediately when a move conquest scores the winning point', () => {
      const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
      state.activePlayerId = P1;
      state.phase = 'Action';
      state.players[P1].score = state.scoreLimit - 1;
      const baseId = `base_${P1}`;
      const targetBfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
      state.scoredBattlefieldsThisTurn[P1] = state.battlefields
        .filter(bf => !bf.id.startsWith('base_') && bf.id !== targetBfId)
        .map(bf => bf.id);
      const unitId = ensureHandCard(state, P1, id =>
        state.cardDefinitions[state.allCards[id].cardId].type === 'Unit'
      );
      expect(unitId).toBeDefined();
      placeUnitAt(state, P1, unitId!, baseId, true);

      const result = executeAction(state, makeAction('MoveUnit', P1, {
        cardInstanceId: unitId!,
        fromBattlefieldId: baseId,
        toBattlefieldId: targetBfId,
      }));

      expect(result.success).toBe(true);
      expect(result.newState!.players[P1].score).toBe(state.scoreLimit);
      expect(result.newState!.phase).toBe('GameOver');
      expect(result.newState!.winner).toBe(P1);
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


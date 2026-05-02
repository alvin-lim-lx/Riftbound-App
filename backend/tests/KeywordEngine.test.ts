import {
  createGame,
  deepClone,
  enterPhase,
  enterShowdown,
  executeAction,
  resolveCombat,
} from '../src/engine/GameEngine';
import type { CardDefinition, Domain, GameAction, GameState } from '../shared/src/types';

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

function addReadyRunes(state: GameState, playerId: string, count: number, domain: Domain = 'Mind'): void {
  for (let i = 0; i < count; i++) {
    const runeId = `${playerId}_test_rune_${domain}_${i}_${Math.random()}`;
    const cardId = `test_rune_${domain}_${i}_${Math.random()}`;
    state.cardDefinitions[cardId] = {
      id: cardId,
      name: `Test ${domain} Rune`,
      type: 'Rune',
      cost: { rune: 0 },
      domains: [domain],
      keywords: [],
      abilities: [],
      set: 'Test',
      rarity: 'Common',
    };
    state.allCards[runeId] = {
      instanceId: runeId,
      cardId,
      ownerId: playerId,
      location: 'rune',
      ready: false,
      exhausted: false,
      stats: {},
      currentStats: {},
      counters: {},
      attachments: [],
      facing: 'up',
      owner_hidden: false,
      damage: 0,
    };
    state.allCards[runeId].location = 'rune';
    state.allCards[runeId].exhausted = false;
  }
}

function ensureHandCard(
  state: GameState,
  playerId: string,
  predicate: (id: string) => boolean
): string {
  const existing = state.players[playerId].hand.find(predicate);
  if (existing) return existing;
  const deckCard = state.players[playerId].deck.find(predicate);
  if (!deckCard) throw new Error('No matching card found');
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

function overrideDef(state: GameState, instanceId: string, patch: Partial<CardDefinition>): void {
  const cardId = state.allCards[instanceId].cardId;
  state.cardDefinitions[cardId] = {
    ...state.cardDefinitions[cardId],
    ...patch,
  };
}

describe('Official keyword engine hooks', () => {
  it('hides a Hidden card only at a controlled battlefield and plays it on a later turn', () => {
    const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
    state.activePlayerId = P1;
    state.phase = 'Action';
    state.turn = 3;
    state.players[P1].charges = 0;
    const bfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
    state.battlefields.find(bf => bf.id === bfId)!.controllerId = P1;
    const unitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
    overrideDef(state, unitId, { type: 'Unit', keywords: ['Hidden'], cost: { rune: 0 }, abilities: [] });
    addReadyRunes(state, P1, 1, 'Mind');

    const hidden = executeAction(state, makeAction('HideCard', P1, { cardInstanceId: unitId, battlefieldId: bfId, hideRuneDomain: 'Mind' }));

    expect(hidden.success).toBe(true);
    expect(hidden.newState!.players[P1].hiddenZone).toContain(unitId);
    expect(hidden.newState!.allCards[unitId].hiddenBattlefieldId).toBe(bfId);
    expect(hidden.newState!.players[P1].runeDeck.length).toBeGreaterThan(state.players[P1].runeDeck.length);

    const sameTurnPlay = executeAction(hidden.newState!, makeAction('PlayUnit', P1, {
      cardInstanceId: unitId,
      battlefieldId: bfId,
      fromHidden: true,
    }));
    expect(sameTurnPlay.success).toBe(false);

    const laterState = deepClone(hidden.newState!);
    laterState.turn = 4;
    const laterPlay = executeAction(laterState, makeAction('PlayUnit', P1, {
      cardInstanceId: unitId,
      battlefieldId: bfId,
      fromHidden: true,
    }));
    expect(laterPlay.success).toBe(true);
    expect(laterPlay.newState!.allCards[unitId].location).toBe('battlefield');
    expect(laterPlay.newState!.players[P1].hiddenZone).not.toContain(unitId);
  });

  it('charges Deflect as extra generic power when an opponent targets the unit', () => {
    const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
    state.activePlayerId = P1;
    state.phase = 'Action';
    const bfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
    const spellId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Spell');
    const targetId = ensureHandCard(state, P2, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
    overrideDef(state, spellId, {
      type: 'Spell',
      cost: { rune: 0 },
      abilities: [{ trigger: 'Static', effect: 'Deal 2 to a unit.', effectCode: '' }],
      keywords: [],
    });
    overrideDef(state, targetId, { type: 'Unit', keywords: ['Deflect'], stats: { might: 3 }, abilities: [] });
    state.allCards[targetId].stats = { might: 3 };
    state.allCards[targetId].currentStats = { might: 3 };
    placeUnitAt(state, P2, targetId, bfId, false);

    expect(executeAction(state, makeAction('PlaySpell', P1, { cardInstanceId: spellId, targetId })).success).toBe(false);

    addReadyRunes(state, P1, 1);
    const result = executeAction(state, makeAction('PlaySpell', P1, { cardInstanceId: spellId, targetId }));
    expect(result.success).toBe(true);
    expect(result.newState!.allCards[targetId].damage).toBe(2);
  });

  it('executes Repeat spell effects an additional paid time', () => {
    const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
    state.activePlayerId = P1;
    state.phase = 'Action';
    const bfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
    const spellId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Spell');
    const targetId = ensureHandCard(state, P2, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
    overrideDef(state, spellId, {
      type: 'Spell',
      cost: { rune: 0 },
      keywords: ['Repeat'],
      abilities: [{ trigger: 'Static', effect: '[Repeat] :rb_energy_1: Deal 2 to a unit.', effectCode: '' }],
    });
    overrideDef(state, targetId, { type: 'Unit', stats: { might: 5 }, abilities: [], keywords: [] });
    state.allCards[targetId].stats = { might: 5 };
    state.allCards[targetId].currentStats = { might: 5 };
    placeUnitAt(state, P2, targetId, bfId, false);
    addReadyRunes(state, P1, 1);

    const result = executeAction(state, makeAction('PlaySpell', P1, {
      cardInstanceId: spellId,
      targetId,
      repeatCount: 1,
      repeatTargets: [targetId],
    }));

    expect(result.success).toBe(true);
    expect(result.newState!.allCards[targetId].damage).toBe(4);
  });

  it('kills Temporary units at Beginning before hold scoring and resolves Deathknell', () => {
    const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
    state.activePlayerId = P1;
    state.phase = 'Beginning';
    state.turn = 5;
    const bfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
    const unitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
    overrideDef(state, unitId, {
      type: 'Unit',
      keywords: ['Temporary', 'Deathknell'],
      stats: { might: 2 },
      abilities: [{ trigger: 'Static', effect: '[Deathknell] Draw 1.', effectCode: '' }],
    });
    placeUnitAt(state, P1, unitId, bfId, false);
    state.battlefields.find(bf => bf.id === bfId)!.controllerId = P1;
    state.battlefields.find(bf => bf.id === bfId)!.scoringPlayerId = P1;
    state.battlefields.find(bf => bf.id === bfId)!.scoringSince = 4;
    const handBefore = state.players[P1].hand.length;
    const scoreBefore = state.players[P1].score;

    const result = enterPhase(state, 'Beginning');

    expect(result.allCards[unitId].location).toBe('discard');
    expect(result.players[P1].hand.length).toBe(handBefore + 1);
    expect(result.players[P1].score).toBe(scoreBefore);
  });

  it('awards Hunt XP on hold scoring', () => {
    const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
    state.activePlayerId = P1;
    state.phase = 'Beginning';
    state.turn = 5;
    const bfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
    const unitId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
    overrideDef(state, unitId, {
      type: 'Unit',
      keywords: ['Hunt'],
      stats: { might: 3 },
      abilities: [{ trigger: 'Static', effect: '[Hunt 2]', effectCode: '' }],
    });
    placeUnitAt(state, P1, unitId, bfId, false);
    const bf = state.battlefields.find(battlefield => battlefield.id === bfId)!;
    bf.controllerId = P1;
    bf.scoringPlayerId = P1;
    bf.scoringSince = 4;

    const result = enterPhase(state, 'Beginning');

    expect(result.players[P1].xp).toBe(2);
  });

  it('applies Assault and Shield combat values', () => {
    const state = deepClone(createGame([P1, P2], ['Alice', 'Bob']));
    state.phase = 'Showdown';
    const bfId = state.battlefields.find(bf => !bf.id.startsWith('base_'))!.id;
    const attackerId = ensureHandCard(state, P1, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
    const defenderId = ensureHandCard(state, P2, id => state.cardDefinitions[state.allCards[id].cardId].type === 'Unit');
    overrideDef(state, attackerId, {
      type: 'Unit',
      keywords: ['Assault', 'Hunt'],
      stats: { might: 2 },
      abilities: [{ trigger: 'Static', effect: '[Assault 2] [Hunt 2]', effectCode: '' }],
    });
    overrideDef(state, defenderId, {
      type: 'Unit',
      keywords: ['Shield'],
      stats: { might: 2 },
      abilities: [{ trigger: 'Static', effect: '[Shield 1]', effectCode: '' }],
    });
    state.allCards[attackerId].stats = { might: 2 };
    state.allCards[attackerId].currentStats = { might: 2 };
    state.allCards[defenderId].stats = { might: 2 };
    state.allCards[defenderId].currentStats = { might: 2 };
    placeUnitAt(state, P1, attackerId, bfId, false);
    placeUnitAt(state, P2, defenderId, bfId, false);

    const assigning = resolveCombat(enterShowdown(state, attackerId, bfId)).newState!;
    expect(assigning.pendingCombatDamageAssignment!.availableDamage).toBe(4);
    const afterAttackAssign = executeAction(assigning, makeAction('AssignCombatDamage', P1, {
      targetOrder: [defenderId],
    })).newState!;
    const result = executeAction(afterAttackAssign, makeAction('AssignCombatDamage', P2, {
      targetOrder: [attackerId],
    }));
    expect(result.success).toBe(true);
  });
});

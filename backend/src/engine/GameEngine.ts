/**
 * Riftbound Game Engine
 * =====================
 * Server-authoritative rules engine.
 * All mutations go through this engine; no direct state changes.
 *
 * Design principles:
 * - Pure functions for validation (read game state, return result)
 * - Imperative execution for state mutation (side-effectful, but deterministic)
 * - Every action produces an ActionResult with the new state
 * - All card definitions are cached in gameState.cardDefinitions
 */

import {
  GameState, PlayerState, CardInstance, BattlefieldState,
  Phase, ActionType, GameAction, CardDefinition,
  SystemLogEntry, GameLogEntry, LogEntryType, EffectStackEntry, Domain,
  ShowdownStackEntry
} from '../../shared/src/types';
import { CARDS } from '../../shared/src/cards';
import { pickRandom, randomId, shuffle } from './utils';

// ============================================================
// Types
// ============================================================

export interface ActionResult {
  success: boolean;
  error?: string;
  action?: GameAction;
  newState?: GameState;
  sideEffects?: GameSideEffect[];
}

export type GameSideEffect =
  | { type: 'DamageUnit'; unitInstanceId: string; damage: number }
  | { type: 'KillUnit'; unitInstanceId: string }
  | { type: 'ReadyUnit'; unitInstanceId: string }
  | { type: 'ExhaustUnit'; unitInstanceId: string }
  | { type: 'MoveUnit'; unitInstanceId: string; from: string; to: string }
  | { type: 'ScoreBattlefield'; battlefieldId: string; playerId: string }
  | { type: 'ConquerBattlefield'; battlefieldId: string; playerId: string }
  | { type: 'AttachGear'; gearInstanceId: string; unitInstanceId: string }
  | { type: 'TriggerAbility'; cardInstanceId: string; trigger: string }
  | { type: 'ApplyModifier'; unitInstanceId: string; modifier: string; value: number }
  | { type: 'ReadyPlayer'; playerId: string }
  | { type: 'GameWin'; playerId: string; reason: string };

const BASE_BATTLEFIELD_PREFIX = 'base_';

function getBaseBattlefieldId(playerId: string): string {
  return `${BASE_BATTLEFIELD_PREFIX}${playerId}`;
}

function isBaseBattlefieldId(id: string): boolean {
  return id.startsWith(BASE_BATTLEFIELD_PREFIX);
}

// ============================================================
// Game Factory
// ============================================================

export interface PlayerDeckConfig {
  legendId: string;
  chosenChampionCardId: string; // type=Champion unit going to Champion Zone
  cardIds: string[];            // main deck (39 cards, excludes Chosen Champion)
  runeIds?: string[];           // rune deck (12 cards)
  battlefieldIds?: string[];     // all battlefields
  sideboardIds?: string[];      // sideboard (8 cards)
}

export function createGame(
  playerIds: string[],
  playerNames: string[],
  options: {
    scoreLimit?: number;
    isPvP?: boolean;
    matchFormat?: 'bo1' | 'bo3';
    playerDecks?: Record<string, PlayerDeckConfig>;
  } = {}
): GameState {
  const { scoreLimit = 8, isPvP = true, matchFormat = 'bo1', playerDecks } = options;

  // Create battlefields. In Bo1, each player randomly chooses one of their
  // three battlefields and those chosen cards are placed in the battlefield zone.
  // Mapping from logical battlefield names to real card IDs in CARDS
  const BF_ID_MAP: Record<string, string> = {
    'Baron_Pit': 'unl-t01',
    'Brush': 'unl-t03',
    // 'The_Grid' doesn't exist in CARDS — use Power Nexus as a substitute
    'The_Grid': 'sfd-214-221',
  };
  const resolveBfCardId = (id: string) => BF_ID_MAP[id] ?? id;
  const defaultBattlefieldIds = ['Baron_Pit', 'Brush', 'The_Grid'];
  const makeBattlefield = (rawCardId: string, i: number): BattlefieldState => {
    const cardId = resolveBfCardId(rawCardId);
    return {
      id: `bf_${i}`,
      name: CARDS[cardId]?.name ?? rawCardId,
      cardId,
      controllerId: null,
      units: [],
      scoringSince: null,
      scoringPlayerId: null,
    };
  };

  let battlefields: BattlefieldState[];
  if (matchFormat === 'bo1') {
    const chosenBattlefieldIds = playerIds.map((pid, i) => {
      const candidates = playerDecks?.[pid]?.battlefieldIds?.filter(Boolean).slice(0, 3);
      return pickRandom(candidates && candidates.length > 0 ? candidates : defaultBattlefieldIds)
        ?? defaultBattlefieldIds[i % defaultBattlefieldIds.length];
    });
    battlefields = chosenBattlefieldIds.map(makeBattlefield);
  } else {
    const bfCardIds = playerDecks?.[playerIds[0]]?.battlefieldIds?.filter(Boolean).slice(0, 3) ?? [...defaultBattlefieldIds];
    while (bfCardIds.length < 3) bfCardIds.push(defaultBattlefieldIds[bfCardIds.length]);
    battlefields = bfCardIds.map(makeBattlefield);
  }

  battlefields.push(...playerIds.map((pid, idx) => ({
    id: getBaseBattlefieldId(pid),
    name: `${playerNames[idx] ?? `Player ${idx + 1}`} Base`,
    cardId: getBaseBattlefieldId(pid),
    controllerId: pid,
    units: [],
    scoringSince: null,
    scoringPlayerId: null,
  })));

  // Create rune decks and initial hands for each player
  const allCards: Record<string, CardInstance> = {};
  const players: Record<string, PlayerState> = {};

  playerIds.forEach((pid, idx) => {
    // Determine deck card ids — use provided deck config or fallback to all cards
    let deckCardIds: string[];
    const deckConfig = playerDecks?.[pid];

    if (deckConfig) {
      // 40 cards in cardIds: includes the Chosen Champion (1 copy)
      // Extract champion → Champion Zone; remaining 39 → shuffled into deck (no duplication)
      const championId = deckConfig.chosenChampionCardId;
      deckCardIds = deckConfig.cardIds.filter(id => id !== championId);
      // deckCardIds is now 39 cards — use as-is, don't duplicate
    } else {
      // Fallback: use all Unit/Spell/Gear cards from the database
      const unitCardIds = Object.keys(CARDS).filter(id =>
        ['Unit', 'Spell', 'Gear'].includes(CARDS[id].type)
      );
      deckCardIds = [];
      for (const cardId of unitCardIds) {
        deckCardIds.push(cardId, cardId);
      }
    }

    deckCardIds = shuffle(deckCardIds);

    const deckInstanceIds: string[] = [];
    for (const cardId of deckCardIds) {
      const instId = `${pid}_deck_${randomId()}`;
      const cardDef = CARDS[cardId];
      allCards[instId] = {
        instanceId: instId,
        cardId,
        ownerId: pid,
        location: 'deck',
        ready: false,
        exhausted: false,
        stats: cardDef?.stats ? { ...cardDef.stats } : {},
        currentStats: cardDef?.stats ? { ...cardDef.stats } : {},
        counters: {},
        attachments: [],
        facing: 'up',
        owner_hidden: false,
        damage: 0,
      };
      deckInstanceIds.push(instId);
    }

    // Draw opening hand of 4 cards (Rule 117)
    const handInstanceIds = deckInstanceIds.splice(0, 4);
    console.log(`[createGame] player=${pid} deckCards=${deckCardIds.length} handInstanceIds=${JSON.stringify(handInstanceIds)}`);
    for (const instId of handInstanceIds) {
      allCards[instId].location = 'hand';
    }

    // Create Rune Deck — use provided runeIds (12 cards) or default 12 generic runes
    let runeDeckIds: string[] = [];
    if (deckConfig?.runeIds && deckConfig.runeIds.length > 0) {
      // Use actual rune cards from deck config
      for (const runeCardId of deckConfig.runeIds) {
        const rid = `${pid}_rune_${randomId()}`;
        allCards[rid] = {
          instanceId: rid,
          cardId: runeCardId,
          ownerId: pid,
          location: 'runeDeck',
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
        runeDeckIds.push(rid);
      }
    } else {
      // Default: 12 generic runes
      for (let r = 0; r < 12; r++) {
        const runeId = `${pid}_rune_${r}`;
        allCards[runeId] = {
          instanceId: runeId,
          cardId: 'Rune',
          ownerId: pid,
          location: 'runeDeck',
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
        runeDeckIds.push(runeId);
      }
    }
    runeDeckIds = shuffle(runeDeckIds);

    // Place Champion Legend in Legend Zone (Rule 112 / 103.1.a)
    let legendInstanceId: string | null = null;
    if (deckConfig?.legendId) {
      const legendDef = CARDS[deckConfig.legendId];
      if (legendDef) {
        const lid = `${pid}_legend_${randomId()}`;
        allCards[lid] = {
          instanceId: lid,
          cardId: deckConfig.legendId,
          ownerId: pid,
          location: 'legend',  // Legend Zone — not in hand
          ready: false,
          exhausted: false,
          stats: legendDef.stats ? { ...legendDef.stats } : {},
          currentStats: legendDef.stats ? { ...legendDef.stats } : {},
          counters: {},
          attachments: [],
          facing: 'up',
          owner_hidden: false,
          damage: 0,
        };
        legendInstanceId = lid;
      }
    }

    // Place Chosen Champion in Champion Zone (Rule 113 / 103.2.a)
    let chosenChampionInstanceId: string | null = null;
    if (deckConfig?.chosenChampionCardId) {
      const champDef = CARDS[deckConfig.chosenChampionCardId];
      if (champDef) {
        const cid = `${pid}_champion_${randomId()}`;
        allCards[cid] = {
          instanceId: cid,
          cardId: deckConfig.chosenChampionCardId,
          ownerId: pid,
          location: 'championZone',  // Champion Zone — not in hand
          ready: false,
          exhausted: false,
          stats: champDef.stats ? { ...champDef.stats } : {},
          currentStats: champDef.stats ? { ...champDef.stats } : {},
          counters: {},
          attachments: [],
          facing: 'up',
          owner_hidden: false,
          damage: 0,
        };
        chosenChampionInstanceId = cid;
      }
    }

    // Build PlayerState with all required fields
    players[pid] = {
      id: pid,
      name: playerNames[idx] ?? `Player ${idx + 1}`,
      hand: handInstanceIds,  // 4 cards — Legend and Chosen Champion are NOT here
      deck: deckInstanceIds,
      runeDeck: runeDeckIds,  // 12 runes
      runeDiscard: [],
      discardPile: [],
      score: 0,
      xp: 0,
      equipment: {},
      hiddenZone: [],
      isReady: false,
      energy: 0,
      maxEnergy: 0,
      charges: 0,
      floatingEnergy: 0,
      legend: legendInstanceId,
      chosenChampion: chosenChampionInstanceId,
      hasGoneFirst: false,
      mulligansComplete: false,
      baseZone: [],
    };
  });

  // Determine first player randomly (Rule 116) — flip a coin
  const firstPlayerIdx = Math.floor(Math.random() * playerIds.length);
  const firstPlayerId = playerIds[firstPlayerIdx];
  players[firstPlayerId].hasGoneFirst = true;

  return {
    id: `game_${randomId()}`,
    turn: 0,
    phase: 'Setup',
    activePlayerId: firstPlayerId,
    players,
    battlefields,
    allCards,
    cardDefinitions: CARDS,
    winner: null,
    scoreLimit,
    actionLog: [
      {
        id: randomId(),
        type: 'GameStart' as const,
        message: `Game started — ${playerNames[0]} vs ${playerNames[1]}`,
        turn: 0,
        phase: 'Setup' as Phase,
        timestamp: Date.now(),
      }
    ],
    createdAt: Date.now(),
    isPvP,
    effectStack: [],  // empty effect stack at game start
    showdown: null,   // no active showdown at game start
  };
}

// ============================================================
// Engine Entry Point
// ============================================================

export function executeAction(
  state: GameState,
  action: GameAction
): ActionResult {
  // In Showdown phase, any player involved (attacker or defender) may act
  const isShowdownParticipant = state.phase === 'Showdown' && state.showdown &&
    (action.playerId === state.showdown.attackerOwnerId ||
     state.showdown.defenderIds.some(id => state.allCards[id]?.ownerId === action.playerId));

  if (!isShowdownParticipant && action.playerId !== state.activePlayerId) {
    return { success: false, error: 'Not your turn.', action };
  }

  // Route to handler
  switch (action.type) {
    case 'Pass': {
      const result = handlePass(state, action);
      return result;
    }
    case 'PlayUnit': {
      const result = handlePlayUnit(state, action);
      return result;
    }
    case 'PlaySpell': {
      const result = handlePlaySpell(state, action);
      return result;
    }
    case 'PlayGear': {
      const result = handlePlayGear(state, action);
      return result;
    }
    case 'EquipGear': {
      const result = handleEquipGear(state, action);
      return result;
    }
    case 'MoveUnit': {
      const result = handleMoveUnit(state, action);
      return result;
    }
    case 'Attack': {
      const result = handleAttack(state, action);
      return result;
    }
    case 'HideCard': {
      const result = handleHideCard(state, action);
      return result;
    }
    case 'ReactFromHidden': {
      const result = handleReactFromHidden(state, action);
      return result;
    }
    case 'UseAbility': {
      const result = handleUseAbility(state, action);
      return result;
    }
    case 'Concede': {
      const result = handleConcede(state, action);
      return result;
    }
    case 'Mulligan': {
      const result = handleMulligan(state, action);
      return result;
    }
    case 'Focus': {
      // Focus action is deprecated — attacker now starts with focus automatically.
      // handleFocus is kept as-is for backwards compatibility but is unreachable
      // via executeAction since the Focus case is no longer routed here.
      return { success: false, error: 'Focus action is deprecated.', action };
    }
    case 'Reaction': {
      const result = handleReaction(state, action);
      return result;
    }
    case 'CloseReactionWindow': {
      const newState = closeReactionWindow(state);
      // Automatically resolve combat after window closes
      const combatResult = resolveCombat(newState);
      return combatResult;
    }
    default:
      return { success: false, error: `Unknown action type: ${action.type}`, action };
  }
}

// ============================================================
// Turn & Phase Management
// ============================================================

const PHASE_ORDER: Phase[] = [
  'Awaken', 'Beginning', 'Channel', 'Draw', 'Action', 'End'
];

// Phases that auto-advance when the effect stack is empty
const AUTO_ADVANCE_PHASES: Phase[] = ['Awaken', 'Beginning', 'Channel', 'Draw'];

export function canAutoAdvancePhase(state: GameState): boolean {
  // Only auto-advance A-B-C-D phases
  if (!AUTO_ADVANCE_PHASES.includes(state.phase)) {
    return false;
  }
  if (state.phase !== 'Beginning') {
    return true;
  }

  return !state.effectStack || state.effectStack.length === 0;
}

export function advancePhase(state: GameState): GameState {
  const currentIdx = PHASE_ORDER.indexOf(state.phase);
  if (currentIdx === -1) return state;

  // Auto-advance to next phase when effect stack is empty (A-B-C-D phases only)
  // NOTE: Each call to advancePhase advances ONE phase. The caller (GameServer)
  // is responsible for calling this repeatedly to chain through multiple A-B-C-D phases.
  if (canAutoAdvancePhase(state)) {
    if (currentIdx < PHASE_ORDER.length - 1) {
      const nextPhase = PHASE_ORDER[currentIdx + 1];
      const nextState = enterPhase(state, nextPhase);
      return nextState;
    } else {
      // End of turn — start new turn
      return startNewTurn(state);
    }
  }

  // Stack non-empty or non-auto-advance phase: enter next phase (await player input)
  if (currentIdx < PHASE_ORDER.length - 1) {
    const nextPhase = PHASE_ORDER[currentIdx + 1];
    const next = enterPhase(state, nextPhase);
    return withPhaseLog(next, state.phase, nextPhase);
  } else {
    return startNewTurn(state);
  }
}

function withPhaseLog(state: GameState, fromPhase: Phase, toPhase: Phase): GameState {
  const newState = deepClone(state);
  newState.actionLog.push(makeLog(newState, newState.activePlayerId, 'PhaseChange',
    `Phase changed from ${fromPhase} to ${toPhase}`));
  return newState;
}

export function startNewTurn(state: GameState): GameState {
  const nextPlayerId = getOpponentId(state, state.activePlayerId);
  const newState = deepClone(state);
  newState.turn = state.turn + 1;
  newState.activePlayerId = nextPlayerId;
  newState.effectStack = [];
  const playerName = newState.players[nextPlayerId]?.name || nextPlayerId;
  newState.actionLog.push(makeLog(newState, nextPlayerId, 'TurnChange',
    `Turn ${newState.turn} begins for ${playerName}`));
  return enterPhase(newState, 'Awaken');
}

export function enterPhase(state: GameState, phase: Phase): GameState {
  // Use deepClone to properly copy nested objects (players, allCards, etc.)
  // so that phase execution functions can mutate safely without affecting the caller's state.
  const newState = deepClone(state);
  newState.phase = phase;

  switch (phase) {
    case 'Setup':
      return executeSetupPhase(newState);
    case 'Mulligan':
      return executeMulliganPhase(newState);
    case 'Awaken':
      return executeAwakenPhase(newState);
    case 'Beginning':
      return executeBeginningPhase(newState);
    case 'Channel':
      return executeChannelPhase(newState);
    case 'Draw':
      return executeDrawPhase(newState);
    case 'Action':
      return newState;
    case 'End':
      return executeEndPhase(newState);
    default:
      return newState;
  }
}

function executeSetupPhase(state: GameState): GameState {
  // Rule 101: Setup Phase
  // - Players place their Legend in the Legend Zone
  // - Players place their Chosen Champion in the Champion Zone
  // - Shuffle both main deck and rune deck
  // - Draw opening hand of 4 cards
  // All of this is already done in createGame().
  // Transition directly to Mulligan phase.
  return enterPhase(state, 'Mulligan');
}

function executeMulliganPhase(state: GameState): GameState {
  // Mulligan phase: each player takes turns deciding which cards to keep.
  // Rule 116 / 117 / 118: Players may mulligan once per game.
  // The activePlayerId at this point is the player who chose first (hasGoneFirst=true).
  // They get the first mulligan action.
  return state;
}

function executeAwakenPhase(state: GameState): GameState {
  const playerId = state.activePlayerId;
  if (!playerId || !state.players[playerId]) return state;
  const newState = deepClone(state);
  const player = newState.players[playerId];

  player.floatingEnergy = 0;
  player.charges = 1;

  for (const runeId of getActiveRuneIds(newState, playerId)) {
    newState.allCards[runeId].exhausted = false;
  }

  // Ready only the active player's units during their Awaken phase.
  for (const bf of newState.battlefields) {
    for (const unitId of bf.units) {
      const unit = newState.allCards[unitId];
      if (unit?.ownerId !== playerId) continue;
      unit.ready = true;
      unit.exhausted = false;
    }
  }

  syncRuneResourceCounters(newState, playerId);

  const playerName = player.name || playerId;
  newState.actionLog.push(makeLog(newState, playerId, 'System',
    `${playerName}'s Awaken — energy: ${player.energy}`,
    { energy: player.energy }
  ));

  return newState;
}

function executeBeginningPhase(state: GameState): GameState {
  const playerId = state.activePlayerId;
  const newState = deepClone(state);

  // Score from Hold — check each battlefield
  newState.effectStack = state.effectStack ?? [];

  if (newState.effectStack.length === 0) {
    newState.effectStack.push(...getBeginningPhaseTriggers(newState, playerId));
  }

  for (const bf of newState.battlefields) {
    if (isBaseBattlefieldId(bf.id)) continue;
    if (bf.controllerId === playerId && bf.units.length > 0 && bf.scoringSince !== null) {
      // Player has held battlefield with units all turn
      const holder = newState.players[playerId];
      holder.score += 1;
        newState.actionLog.push(makeLog(newState, playerId, 'Score', `Scored 1 point from ${bf.name}`));
    }
  }

  return newState;
}

function executeChannelPhase(state: GameState): GameState {
  const playerId = state.activePlayerId;
  const newState = deepClone(state);
  const player = newState.players[playerId];

  // Channel 2 Runes from Rune Deck into Rune Pool. The second player channels 3 on their first turn.
  const channelCount = state.turn === 2 && !player.hasGoneFirst ? 3 : 2;
  const drawnRuneIds: string[] = [];
  for (let i = 0; i < channelCount; i++) {
    const runeId = player.runeDeck.shift();
    if (runeId) {
      drawnRuneIds.push(runeId);
      // Set location to 'rune' (active rune pool visible in top bar)
      (newState.allCards[runeId] as { location: string }).location = 'rune';
      newState.allCards[runeId].exhausted = false;
    }
  }

  // Log each rune channeled — runes are fully public, both players see rune names
  const playerName = newState.players[playerId]?.name || playerId;
  for (const runeId of drawnRuneIds) {
    const runeCardId = newState.allCards[runeId].cardId;
    newState.actionLog.push(makeLog(newState, playerId, 'Channel',
      `${playerName} channeled ${newState.cardDefinitions[runeCardId]?.name ?? 'a rune'}`,
      { runeCardId, runeInstanceId: runeId }
    ));
  }

  syncRuneResourceCounters(newState, playerId);
  return newState;
}

function executeDrawPhase(state: GameState): GameState {
  const playerId = state.activePlayerId;
  const newState = deepClone(state);
  const player = newState.players[playerId];

  // Draw 1 card from Main Deck
  const cardId = player.deck.shift();
  if (cardId) {
    newState.allCards[cardId].location = 'hand';
    player.hand.push(cardId);

    // Log draw — two-entry pattern for hand privacy:
    // Actor sees: full card name; Opponent sees: anonymized
    const playerName = newState.players[playerId].name;
    const cardDef = newState.cardDefinitions[newState.allCards[cardId].cardId];
    // Full name for actor
    newState.actionLog.push(makeLog(newState, playerId, 'Draw',
      `${playerName} drew ${cardDef.name}`,
      { cardId: cardDef.id, cardInstanceId: cardId, fromZone: 'deck', toZone: 'hand', _isSelfOnly: true }
    ));
    // Anonymized for opponent
    newState.actionLog.push(makeLog(newState, playerId, 'Draw',
      `${playerName} drew 1 card`,
      { count: 1, fromZone: 'deck', toZone: 'hand' }
    ));
  }

  syncRuneResourceCounters(newState, playerId);
  return newState;
}

function executeCombatPhase(state: GameState): GameState {
  // Combat is entered but resolves when Attack action is taken
  return state;
}

function executeEndPhase(state: GameState): GameState {
  const newState = deepClone(state);

  // Reset damage for all units at end of turn
  resetDamage(newState);

  newState.players[newState.activePlayerId].floatingEnergy = 0;
  syncRuneResourceCounters(newState, newState.activePlayerId);

  // Kill Temporary units (End of Turn behavior)
  for (const bf of newState.battlefields) {
    const toKill: string[] = [];
    for (const unitId of bf.units) {
      const unit = newState.allCards[unitId];
      if (!unit) continue;
      const def = newState.cardDefinitions[unit.cardId];
      if (def.keywords.includes('Temporary')) {
        toKill.push(unitId);
      }
    }
    for (const killId of toKill) {
      bf.units = bf.units.filter(id => id !== killId);
      newState.allCards[killId].location = 'discard';
      newState.players[getUnitOwner(newState, killId)].discardPile.push(killId);
    }
  }

  // Check for score after holding battlefields
  const scoredState = checkScoring(newState);

  // Check win condition
  const winner = checkWinCondition(scoredState);
  if (winner) {
    return { ...scoredState, phase: 'GameOver', winner };
  }

  return advancePhase(scoredState);
}

export function checkScoring(state: GameState): GameState {
  for (const bf of state.battlefields) {
    if (isBaseBattlefieldId(bf.id)) continue;
    if (!bf.controllerId) continue;
    if (bf.units.length === 0) {
      // Controller has no units — stop scoring
      if (bf.scoringPlayerId && bf.scoringSince !== null) {
        // Score was happening, player held it all turn
        const holder = state.players[bf.scoringPlayerId];
        holder.score += 1;
        state.actionLog.push(makeLog(state, bf.scoringPlayerId, 'Score', `Scored 1 point from ${bf.name}`));
      }
      bf.scoringSince = null;
      bf.scoringPlayerId = null;
    }
  }
  return state;
}

export function checkWinCondition(state: GameState): string | null {
  for (const [pid, player] of Object.entries(state.players)) {
    if (player.score >= state.scoreLimit) {
      return pid;
    }
  }
  return null;
}

// ============================================================
// Showdown & Combat
// ============================================================

export function enterShowdown(
  state: GameState,
  attackerId: string,
  targetBattlefieldId: string
): GameState {
  const newState = deepClone(state);
  const bf = newState.battlefields.find(b => b.id === targetBattlefieldId)!;
  const attacker = state.allCards[attackerId];
  const attackerOwner = attacker.ownerId;

  // Gather defender unitIds at this BF (opponents only)
  const defenderIds = bf.units.filter(id =>
    newState.allCards[id].ownerId !== attackerOwner
  );

  // Determine who gets Focus:
  // - If the BF is empty → attacker gets Focus immediately (Rule 508.1)
  // - If the BF is contested → Focus goes to attacker automatically (flowchart: attacker starts)
  const bfIsEmpty = defenderIds.length === 0;
  const focusPlayerId = bfIsEmpty ? attackerOwner : attackerOwner;

  newState.phase = 'Showdown';
  newState.showdown = {
    battlefieldId: targetBattlefieldId,
    attackerIds: [attackerId],
    attackerOwnerId: attackerOwner,
    focusPlayerId,
    defenderIds,
    reactionWindowOpen: true,
    combatResolved: false,
    winner: null,
    excessDamage: 0,
    actionStack: [],
    passTracker: [false, false],
    chainOpen: true,
  };

  // --- Initial Chain (automatic) ---
  // Push "When I Attack" ability from the attacker onto the stack
  const attackerDef = state.cardDefinitions[attacker.cardId];
  for (const ability of attackerDef.abilities ?? []) {
    if (ability.trigger === 'ATTACK') {
      newState.showdown.actionStack.push({
        id: randomId(),
        sourceId: attackerId,
        ownerId: attackerOwner,
        type: 'ability',
        effect: ability.effect,
        resolves: false,
      });
    }
  }

  // Push "When I Defend" ability from each defender onto the stack
  for (const defId of defenderIds) {
    const defCard = state.allCards[defId];
    if (!defCard) continue;
    const defDef = state.cardDefinitions[defCard.cardId];
    for (const ability of defDef.abilities ?? []) {
      if (ability.trigger === 'DEFEND') {
        newState.showdown.actionStack.push({
          id: randomId(),
          sourceId: defId,
          ownerId: defCard.ownerId,
          type: 'ability',
          effect: ability.effect,
          resolves: false,
        });
      }
    }
  }

  newState.actionLog.push(makeLog(newState, attackerOwner, 'Showdown',
    `${state.cardDefinitions[attacker.cardId].name} entered ${bf.name}${bfIsEmpty ? ' (Focus claimed)' : ' — Showdown!'}`));

  return newState;
}

export function canClaimFocus(state: GameState, playerId: string): boolean {
  if (state.phase !== 'Showdown' || !state.showdown) return false;
  if (state.showdown.focusPlayerId !== null) return false;
  const { attackerOwnerId, defenderIds } = state.showdown;
  const isAttacker = playerId === attackerOwnerId;
  const isDefender = defenderIds.some(id => state.allCards[id]?.ownerId === playerId);
  return isAttacker || isDefender;
}

export function handleFocus(state: GameState, action: GameAction): ActionResult {
  if (!canClaimFocus(state, action.playerId)) {
    return { success: false, error: 'Cannot claim Focus.', action };
  }

  const newState = deepClone(state);
  newState.showdown = { ...newState.showdown!, focusPlayerId: action.playerId };
  newState.actionLog.push(makeLog(newState, action.playerId, 'Focus', `Player claimed Focus.`));
  return { success: true, action, newState };
}

export function canPlayReaction(state: GameState, playerId: string, cardInstanceId: string): boolean {
  if (state.phase !== 'Showdown' || !state.showdown) return false;
  if (!state.showdown.reactionWindowOpen) return false;
  // Must have focus to play a reaction
  if (state.showdown.focusPlayerId !== playerId) return false;
  const card = state.allCards[cardInstanceId];
  if (!card || card.location !== 'hand') return false;
  if (card.ownerId !== playerId) return false;
  const def = state.cardDefinitions[card.cardId];
  if (!def.keywords.includes('Reaction')) return false;
  const player = state.players[playerId];
  const cost = def.cost?.charges ?? 0;
  if (player.charges < cost) return false;
  return true;
}

export function handleReaction(state: GameState, action: GameAction): ActionResult {
  const { cardInstanceId } = action.payload as { cardInstanceId: string };
  if (!canPlayReaction(state, action.playerId, cardInstanceId)) {
    return { success: false, error: 'Cannot play Reaction card.', action };
  }

  const newState = deepClone(state);
  const card = newState.allCards[cardInstanceId];
  const def = newState.cardDefinitions[card.cardId];
  const player = newState.players[action.playerId];

  // Pay charges
  const cost = def.cost?.charges ?? 0;
  player.charges -= cost;

  // Move to battlefield face-up
  card.location = 'battlefield';
  card.facing = 'up';
  card.owner_hidden = false;
  const bfId = state.showdown!.battlefieldId;
  card.battlefieldId = bfId;
  const bf = newState.battlefields.find(b => b.id === bfId)!;
  if (!bf.units.includes(cardInstanceId)) bf.units.push(cardInstanceId);

  // Remove from hand
  player.hand = player.hand.filter(id => id !== cardInstanceId);

  // Push onto showdown action stack
  pushToActionStack(newState, cardInstanceId, action.playerId, 'reaction', `Reaction: ${def.name}`);

  // Flip focus to opponent
  const opponentId = getOpponentId(newState, action.playerId);
  newState.showdown!.focusPlayerId = opponentId;

  newState.actionLog.push(makeLog(newState, action.playerId, 'Showdown',
    `${player.name} played Reaction: ${def.name}`));

  return { success: true, action, newState };
}

export function closeReactionWindow(state: GameState): GameState {
  if (!state.showdown) return state;
  const newState = deepClone(state);
  newState.showdown = { ...newState.showdown, reactionWindowOpen: false };
  return newState;
}

// ============================================================
// Showdown Action Stack
// ============================================================

function pushToActionStack(
  state: GameState,
  sourceId: string,
  ownerId: string,
  type: ShowdownStackEntry['type'],
  effect: string
): void {
  // Mutate in-place — caller already did deepClone
  state.showdown!.actionStack.push({
    id: randomId(),
    sourceId,
    ownerId,
    type,
    effect,
    resolves: false,
  });
  // Any non-pass action resets the pass tracker
  state.showdown!.passTracker = [false, false];
  state.showdown!.chainOpen = true;
}

function canChainReact(state: GameState, playerId: string): boolean {
  if (!state.showdown || !state.showdown.chainOpen) return false;
  if (state.showdown.focusPlayerId !== playerId) return false;
  return true;
}

function canStartChain(state: GameState, playerId: string): boolean {
  if (!state.showdown) return false;
  if (state.showdown.combatResolved) return false;
  if (state.showdown.focusPlayerId !== playerId) return false;
  // Can start a chain only when no chain is currently open
  // (once a chain is open, players can only join, not start a new one)
  return true;
}

function executeStackEntry(
  state: GameState,
  entry: ShowdownStackEntry
): GameSideEffect[] {
  const card = state.allCards[entry.sourceId];
  if (!card) return [];

  const def = state.cardDefinitions[card.cardId];
  const effects: GameSideEffect[] = [];

  // Apply the ability's effectCode to the game state
  for (const ability of def.abilities ?? []) {
    const code = ability.effectCode ?? ability.trigger;

    // Deal damage effects
    if (code.includes('DEAL_')) {
      const match = code.match(/DEAL_(\d+)/);
      const damage = match ? parseInt(match[1]) : 0;
      // Find target(s) — for now, find enemy units at the contested BF
      const bf = state.battlefields.find(b => b.id === state.showdown!.battlefieldId);
      if (bf) {
        const enemies = bf.units.filter(id => state.allCards[id]?.ownerId !== entry.ownerId);
        for (const enemyId of enemies) {
          const died = takeDamage(state, enemyId, damage);
          effects.push({ type: 'DamageUnit', unitInstanceId: enemyId, damage });
        }
      }
    }

    // Give might effects
    if (code.includes('GIVE_MIGHT')) {
      const match = code.match(/GIVE_MIGHT_(\d+)/);
      const bonus = match ? parseInt(match[1]) : 0;
      const targetId = entry.sourceId;
      const unit = state.allCards[targetId];
      if (unit) {
        unit.currentStats.might = (unit.currentStats.might ?? 0) + bonus;
        effects.push({ type: 'ApplyModifier', unitInstanceId: targetId, modifier: 'might', value: bonus });
      }
    }

    // Ready unit effects
    if (code.includes('READY_UNIT')) {
      const targetId = entry.sourceId;
      const unit = state.allCards[targetId];
      if (unit && unit.location === 'battlefield') {
        unit.ready = true;
        effects.push({ type: 'ReadyUnit', unitInstanceId: targetId });
      }
    }

    // Assault effects
    if (code.includes('GIVE_ASSAULT')) {
      const match = code.match(/\+(\d+)/);
      const bonus = match ? parseInt(match[1]) : 0;
      const targetId = entry.sourceId;
      const unit = state.allCards[targetId];
      if (unit) {
        effects.push({ type: 'ApplyModifier', unitInstanceId: targetId, modifier: 'assault', value: bonus });
      }
    }
  }

  return effects;
}

function resolveActionStack(state: GameState): ActionResult {
  const newState = deepClone(state);
  newState.showdown!.chainOpen = false;

  while (newState.showdown!.actionStack.length > 0) {
    const entry = newState.showdown!.actionStack.pop()!; // LIFO

    // Execute the entry's effect
    const effects = executeStackEntry(newState, entry);

    // ⚠️ If executeStackEntry triggers a new reaction (e.g., unit death → deathrattle),
    // new entries are pushed onto actionStack and chainOpen becomes true.
    // The while loop must re-evaluate — a new chain has started.
    if (newState.showdown!.chainOpen) {
      // Chain restarted during resolution — break and let players continue
      break;
    }
  }

  // If stack is fully drained and chain is closed, mark reaction window closed
  if (newState.showdown!.actionStack.length === 0 && !newState.showdown!.chainOpen) {
    newState.showdown!.reactionWindowOpen = false;
  }

  return { success: true, newState };
}

function takeDamage(state: GameState, unitId: string, amount: number): boolean {
  const unit = state.allCards[unitId];
  if (!unit || unit.location === 'discard' || unit.location === 'hand') return false;
  if (amount <= 0) return false;
  unit.damage = (unit.damage || 0) + amount;
  return checkUnitDeath(state, unitId);
}

function checkUnitDeath(state: GameState, unitId: string): boolean {
  const unit = state.allCards[unitId];
  if (!unit || unit.location === 'discard') return false;
  const totalHealth = unit.currentStats.might ?? unit.stats.might ?? 1;
  if ((unit.damage || 0) >= totalHealth) {
    killUnit(state, unitId);
    return true;
  }
  return false;
}

function killUnit(state: GameState, unitId: string): void {
  const unit = state.allCards[unitId];
  if (!unit) return;
  unit.location = 'discard';
  unit.damage = 0;
  for (const bf of state.battlefields) {
    bf.units = bf.units.filter(id => id !== unitId);
  }
  const ownerId = unit.ownerId;
  state.players[ownerId].discardPile.push(unitId);
  state.actionLog.push(makeLog(state, ownerId, 'System', `${state.cardDefinitions[unit.cardId].name} was killed.`));
}

function resetDamage(state: GameState): void {
  for (const bf of state.battlefields) {
    for (const uid of bf.units) {
      const unit = state.allCards[uid];
      if (unit) unit.damage = 0;
    }
  }
}

export function resolveCombat(state: GameState): ActionResult {
  if (state.phase !== 'Showdown' || !state.showdown) {
    return { success: false, error: 'Not in Showdown.', newState: state };
  }
  if (state.showdown.combatResolved) {
    return { success: false, error: 'Combat already resolved.', newState: state };
  }

  const newState = deepClone(state);
  const { battlefieldId, attackerIds, attackerOwnerId, defenderIds } = newState.showdown;
  const bf = newState.battlefields.find(b => b.id === battlefieldId)!;
  const attackerId = attackerIds[0];
  const attacker = newState.allCards[attackerId];

  // Close reaction window
  newState.showdown = { ...newState.showdown, reactionWindowOpen: false };

  // Calculate total Might for each side
  let totalAttackerMight = calculateMight(newState, attackerId);
  let totalDefenderMight = defenderIds.reduce((sum, id) => sum + calculateMight(newState, id), 0);

  // Apply Assault keyword to attacker
  const attackerDef = newState.cardDefinitions[attacker.cardId];
  const assaultAbility = attackerDef.abilities?.find(a => a.effectCode?.startsWith('GIVE_ASSAULT'));
  if (assaultAbility) {
    const match = assaultAbility.effect.match(/\+(\d+)/);
    if (match) totalAttackerMight += parseInt(match[1]);
  }

  const effects: GameSideEffect[] = [];
  let survivingAttackers: string[] = [];
  let survivingDefenders: string[] = [];

  if (defenderIds.length === 0) {
    // Empty BF — no combat, just Focus claimed
    survivingAttackers = attackerIds;
  } else {
    // Both sides present — bidirectional ordered damage assignment
    // Phase 1: Attacker distributes totalAttackerMight across defenders
    survivingDefenders = [];
    let remainingAttackerDamage = totalAttackerMight;
    for (const defenderId of defenderIds) {
      if (remainingAttackerDamage <= 0) { survivingDefenders.push(defenderId); continue; }
      const killThreshold = calculateMight(newState, defenderId);
      const damageToAssign = Math.min(remainingAttackerDamage, killThreshold);
      const died = takeDamage(newState, defenderId, damageToAssign);
      if (!died) survivingDefenders.push(defenderId);
      remainingAttackerDamage -= damageToAssign;
    }

    // Phase 2: Defender distributes totalDefenderMight across attackers
    survivingAttackers = [];
    let remainingDefenderDamage = totalDefenderMight;
    for (const atkId of attackerIds) {
      if (remainingDefenderDamage <= 0) { survivingAttackers.push(atkId); continue; }
      const killThreshold = calculateMight(newState, atkId);
      const damageToAssign = Math.min(remainingDefenderDamage, killThreshold);
      const died = takeDamage(newState, atkId, damageToAssign);
      if (!died) survivingAttackers.push(atkId);
      remainingDefenderDamage -= damageToAssign;
    }

    // Determine winner
    let winner: 'attacker' | 'defender' | 'draw' | null = null;
    if (survivingAttackers.length > 0 && survivingDefenders.length === 0) {
      winner = 'attacker';
    } else if (survivingDefenders.length > 0 && survivingAttackers.length === 0) {
      winner = 'defender';
    } else {
      winner = 'draw';
    }

    // Excess damage = Might difference for conquest
    const excess = Math.abs(totalAttackerMight - totalDefenderMight);

    // Conquest: if attacker wins and defenders are wiped
    if (winner === 'attacker') {
      bf.controllerId = attackerOwnerId;
      bf.scoringSince = newState.turn;
      bf.scoringPlayerId = attackerOwnerId;
      effects.push({ type: 'ConquerBattlefield', battlefieldId: bf.id, playerId: attackerOwnerId });
    }

    newState.showdown = {
      ...newState.showdown!,
      combatResolved: true,
      winner,
      excessDamage: excess,
    };

    // Reset damage for all surviving units after combat
    for (const uid of [...survivingAttackers, ...survivingDefenders]) {
      const u = newState.allCards[uid];
      if (u) u.damage = 0;
    }

    newState.actionLog.push(makeLog(newState, attackerOwnerId, 'Combat',
      `Combat at ${bf.name}: Attacker Might ${totalAttackerMight} vs Defender Might ${totalDefenderMight} — ${winner?.toUpperCase()}`));
  }

  // Check win condition
  const winner = checkWinCondition(newState);
  if (winner) {
    newState.phase = 'GameOver';
    newState.winner = winner;
    newState.showdown = null;
    return {
      success: true,
      newState,
      sideEffects: [...effects, { type: 'GameWin', playerId: winner, reason: 'score' }]
    };
  }

  // Return to Action phase
  newState.phase = 'Action';
  newState.showdown = null;
  const finalState = newState;
  return { success: true, newState: finalState, sideEffects: effects };
}

// ============================================================
// Rune Payment Helpers
// ============================================================

const RIFTBOUND_DOMAINS: Domain[] = ['Chaos', 'Calm', 'Fury', 'Mind', 'Body', 'Order'];

type CostPaymentResult = { success: boolean; error?: string };

function getPlayableDomains(def: CardDefinition): Domain[] {
  return (def.domains ?? []).filter(domain => RIFTBOUND_DOMAINS.includes(domain));
}

function getRuneDomain(state: GameState, runeId: string): Domain | null {
  const rune = state.allCards[runeId];
  const def = rune ? state.cardDefinitions[rune.cardId] : undefined;
  return getPlayableDomains(def ?? ({} as CardDefinition))[0] ?? null;
}

function getActiveRuneIds(state: GameState, playerId: string): string[] {
  return Object.values(state.allCards)
    .filter(card => card.ownerId === playerId && card.location === 'rune')
    .map(card => card.instanceId);
}

function getReadyRuneIds(state: GameState, playerId: string): string[] {
  return getActiveRuneIds(state, playerId).filter(runeId => !state.allCards[runeId].exhausted);
}

function syncRuneResourceCounters(state: GameState, playerId: string): void {
  const player = state.players[playerId];
  if (!player) return;
  player.floatingEnergy = player.floatingEnergy ?? 0;
  const activeRuneIds = getActiveRuneIds(state, playerId);
  const readyRuneCount = activeRuneIds.filter(runeId => !state.allCards[runeId].exhausted).length;
  player.energy = readyRuneCount + player.floatingEnergy;
  player.maxEnergy = activeRuneIds.length + player.floatingEnergy;
}

function chooseEnergyRunes(
  state: GameState,
  playerId: string,
  cardDomains: Domain[],
  amount: number
): string[] {
  const readyRuneIds = getReadyRuneIds(state, playerId);
  const selected = new Set<string>();
  const take = (predicate: (runeId: string) => boolean, count: number) => {
    for (const runeId of readyRuneIds) {
      if (selected.size >= amount || count <= 0) break;
      if (selected.has(runeId) || !predicate(runeId)) continue;
      selected.add(runeId);
      count--;
    }
  };

  if (cardDomains.length >= 2) {
    const firstTarget = Math.ceil(amount / 2);
    const secondTarget = Math.floor(amount / 2);
    take(runeId => getRuneDomain(state, runeId) === cardDomains[0], firstTarget);
    take(runeId => getRuneDomain(state, runeId) === cardDomains[1], secondTarget);
    take(runeId => cardDomains.includes(getRuneDomain(state, runeId) as Domain), amount - selected.size);
  } else if (cardDomains.length === 1) {
    take(runeId => getRuneDomain(state, runeId) === cardDomains[0], amount);
  }

  take(() => true, amount - selected.size);
  return Array.from(selected);
}

function choosePowerRune(
  state: GameState,
  playerId: string,
  preferredDomain: Domain | undefined,
  alreadySelected: Set<string>
): string | null {
  const activeRuneIds = getActiveRuneIds(state, playerId).filter(runeId => !alreadySelected.has(runeId));
  // preferredDomain must always be matched; exhausted runes are preferred over ready ones
  const passes = [
    (runeId: string) => state.allCards[runeId].exhausted && getRuneDomain(state, runeId) === preferredDomain,
    (runeId: string) => !state.allCards[runeId].exhausted && getRuneDomain(state, runeId) === preferredDomain,
    // Fallbacks still require the correct domain — no wildcard matching
    (runeId: string) => state.allCards[runeId].exhausted && (preferredDomain === undefined || getRuneDomain(state, runeId) === preferredDomain),
    (runeId: string) => !state.allCards[runeId].exhausted && (preferredDomain === undefined || getRuneDomain(state, runeId) === preferredDomain),
  ];

  for (const pass of passes) {
    const runeId = activeRuneIds.find(pass);
    if (runeId) return runeId;
  }
  return null;
}

function payCardCosts(
  state: GameState,
  playerId: string,
  def: CardDefinition,
  extraEnergy = 0,
  powerRuneDomains: Domain[] = []
): CostPaymentResult {
  const player = state.players[playerId];
  if (!player) return { success: false, error: 'Player not found.' };

  const cardDomains = getPlayableDomains(def);
  const energyCost = (def.cost?.rune ?? 0) + extraEnergy;
  const powerCost = def.cost?.power ?? 0;

  if (cardDomains.length >= 2 && powerCost > 0) {
    if (powerRuneDomains.length !== powerCost) {
      return { success: false, error: 'Choose one rune domain for each power cost.' };
    }
    if (powerRuneDomains.some(domain => !cardDomains.includes(domain))) {
      return { success: false, error: 'Power rune domain must match one of the card domains.' };
    }
  }

  player.floatingEnergy = player.floatingEnergy ?? 0;
  const floatingSpent = Math.min(player.floatingEnergy, energyCost);
  const readyNeeded = energyCost - floatingSpent;
  const energyRunes = chooseEnergyRunes(state, playerId, cardDomains, readyNeeded);
  if (energyRunes.length < readyNeeded) return { success: false, error: 'Not enough ready runes.' };

  player.floatingEnergy -= floatingSpent;
  for (const runeId of energyRunes) {
    state.allCards[runeId].exhausted = true;
  }

  const selectedPowerRunes = new Set<string>();
  const selectedPowerRuneIds: string[] = [];
  for (let i = 0; i < powerCost; i++) {
    const preferredDomain = cardDomains.length >= 2 ? powerRuneDomains[i] : cardDomains[0];
    const runeId = choosePowerRune(state, playerId, preferredDomain, selectedPowerRunes);
    if (!runeId) return { success: false, error: 'Not enough runes to recycle for power.' };
    selectedPowerRunes.add(runeId);
    selectedPowerRuneIds.push(runeId);
  }

  for (const runeId of selectedPowerRuneIds) {
    const rune = state.allCards[runeId];
    if (!rune.exhausted) player.floatingEnergy += 1;
    rune.location = 'runeDeck';
    rune.exhausted = false;
    rune.ready = false;
    player.runeDeck.push(runeId);
  }

  syncRuneResourceCounters(state, playerId);
  return { success: true };
}

function buildAutoPowerRuneDomains(def: CardDefinition): Domain[] {
  const domains = getPlayableDomains(def);
  const powerCost = def.cost?.power ?? 0;
  if (domains.length < 2 || powerCost <= 0) return [];
  return Array.from({ length: powerCost }, (_, index) => domains[index % 2]);
}

function canPayCardCosts(
  state: GameState,
  playerId: string,
  def: CardDefinition,
  extraEnergy = 0,
  powerRuneDomains: Domain[] = buildAutoPowerRuneDomains(def)
): boolean {
  const testState = deepClone(state);
  return payCardCosts(testState, playerId, def, extraEnergy, powerRuneDomains).success;
}

// ============================================================
// Action Handlers
// ============================================================

function handlePass(state: GameState, action: GameAction): ActionResult {
  // In Showdown phase, Pass checks for consecutive passes then resolves
  if (state.phase === 'Showdown') {
    const newState = deepClone(state);
    const { focusPlayerId, attackerOwnerId, defenderIds } = newState.showdown!;

    const isAttacker = focusPlayerId === attackerOwnerId;

    // Set pass flag for current player
    if (isAttacker) {
      newState.showdown!.passTracker[0] = true;
    } else {
      newState.showdown!.passTracker[1] = true;
    }

    // Check if both passed consecutively
    if (newState.showdown!.passTracker[0] && newState.showdown!.passTracker[1]) {
      // Both passed consecutively — resolve action stack LIFO
      const stackResult = resolveActionStack(newState);
      if (!stackResult.success) return stackResult;

      // After stack drains: if combat not yet resolved, resolve combat
      if (!stackResult.newState!.showdown!.combatResolved) {
        const combatResult = resolveCombat(stackResult.newState!);
        return combatResult;
      }

      return { success: true, action, newState: stackResult.newState };
    } else {
      // Flip focus to opponent
      const opponentId = getOpponentId(newState, focusPlayerId!);
      newState.showdown!.focusPlayerId = opponentId;
      newState.actionLog.push(makeLog(newState, action.playerId, 'System',
        `${newState.players[action.playerId].name} passed focus.`));
      return { success: true, action, newState };
    }
  }

  // Non-showdown: normal phase advance
  const newState = advancePhase(deepClone(state));
  return { success: true, action, newState };
}

function handlePlayUnit(
  state: GameState,
  action: GameAction
): ActionResult {
  const { cardInstanceId, battlefieldId, hidden, accelerate, powerRuneDomains } = action.payload as {
    cardInstanceId: string; battlefieldId: string; hidden: boolean; accelerate?: boolean; powerRuneDomains?: Domain[];
  };

  const card = state.allCards[cardInstanceId];
  if (!card) return { success: false, error: 'Card not found.', action };
  if (card.location !== 'hand') return { success: false, error: 'Card not in hand.', action };
  if (card.ownerId !== action.playerId) return { success: false, error: 'Not your card.', action };

  const def = state.cardDefinitions[card.cardId];
  if (def.type !== 'Unit') return { success: false, error: 'Not a unit.', action };
  if (!def.cost) return { success: false, error: 'No cost defined.', action };

  const accelCost = accelerate ? 1 : 0;

  const bf = state.battlefields.find(b => b.id === battlefieldId);
  if (!bf) return { success: false, error: 'Battlefield not found.', action };

  const newState = deepClone(state);
  newState.allCards[cardInstanceId] = { ...newState.allCards[cardInstanceId] };
  const newCard = newState.allCards[cardInstanceId];
  const newBf = newState.battlefields.find(b => b.id === battlefieldId);
  if (!newBf) return { success: false, error: 'Battlefield not found.', action };

  const costResult = payCardCosts(newState, action.playerId, def, accelCost, powerRuneDomains);
  if (!costResult.success) return { success: false, error: costResult.error, action };

  // Remove from hand
  newState.players[action.playerId].hand = newState.players[action.playerId].hand.filter(id => id !== cardInstanceId);

  // Move to battlefield
  newCard.location = 'battlefield';
  newCard.battlefieldId = battlefieldId;
  newCard.facing = hidden ? 'down' : 'up';
  newCard.owner_hidden = hidden;
  newBf.units.push(cardInstanceId);

  // Units enter exhausted by default unless the play explicitly readies them.
  const hasAccelerate = def.keywords.includes('Accelerate');
  if (accelerate && hasAccelerate) {
    newCard.ready = true;
    newCard.exhausted = false;
  } else {
    newCard.ready = false;
    newCard.exhausted = true;
  }

  // Trigger play abilities
  const effects = resolveAbilities(newState, cardInstanceId, 'PLAY');

  return { success: true, action, newState, sideEffects: effects };
}

function handlePlaySpell(
  state: GameState,
  action: GameAction
): ActionResult {
  const { cardInstanceId, targetId, targetBattlefieldId, powerRuneDomains } = action.payload as {
    cardInstanceId: string; targetId?: string; targetBattlefieldId?: string; powerRuneDomains?: Domain[];
  };

  const card = state.allCards[cardInstanceId];
  if (!card) return { success: false, error: 'Card not found.', action };
  if (card.location !== 'hand') return { success: false, error: 'Card not in hand.', action };

  const def = state.cardDefinitions[card.cardId];
  if (def.type !== 'Spell') return { success: false, error: 'Not a spell.', action };

  // --- Showdown: push to stack instead of immediate resolution ---
  if (state.phase === 'Showdown' && state.showdown) {
    const newState = deepClone(state);

    const costResult = payCardCosts(newState, action.playerId, def, 0, powerRuneDomains);
    if (!costResult.success) return { success: false, error: costResult.error, action };
    newState.players[action.playerId].hand = newState.players[action.playerId].hand.filter(id => id !== cardInstanceId);

    // Determine spell speed: Reaction keyword = Reaction speed; otherwise Action speed
    const isReactionSpell = def.keywords.includes('Reaction');

    // If chain is open, only Reaction spells can be played
    if (state.showdown.chainOpen && !isReactionSpell) {
      return { success: false, error: 'Only Reaction-speed spells can be played while a chain is active.', action };
    }

    // If starting a new chain, must have focus
    if (!state.showdown.chainOpen && state.showdown.focusPlayerId !== action.playerId) {
      return { success: false, error: 'You do not have focus to start a new chain.', action };
    }

    // If joining an active chain, must have focus
    if (state.showdown.chainOpen && state.showdown.focusPlayerId !== action.playerId) {
      return { success: false, error: 'You do not have focus.', action };
    }

    // Move card to discard (spells resolve from discard pile)
    newState.allCards[cardInstanceId].location = 'discard';
    newState.players[action.playerId].discardPile.push(cardInstanceId);

    // Push onto showdown action stack
    pushToActionStack(newState, cardInstanceId, action.playerId, 'spell', `Spell: ${def.name}`);

    // Flip focus to opponent
    const opponentId = getOpponentId(newState, action.playerId);
    newState.showdown!.focusPlayerId = opponentId;

    newState.actionLog.push(makeLog(newState, action.playerId, 'Showdown',
      `${newState.players[action.playerId].name} cast Spell: ${def.name}`));

    return { success: true, action, newState };
  }

  // --- Normal (non-showdown) spell resolution ---
  const newState = deepClone(state);
  newState.allCards[cardInstanceId] = { ...newState.allCards[cardInstanceId] };
  const newCard = newState.allCards[cardInstanceId];

  const costResult = payCardCosts(newState, action.playerId, def, 0, powerRuneDomains);
  if (!costResult.success) return { success: false, error: costResult.error, action };
  newState.players[action.playerId].hand = newState.players[action.playerId].hand.filter(id => id !== cardInstanceId);
  newCard.location = 'discard';
  newState.players[action.playerId].discardPile.push(cardInstanceId);

  // Resolve spell effects
  const effects = resolveSpellEffect(newState, cardInstanceId, targetId, targetBattlefieldId);

  return { success: true, action, newState, sideEffects: effects };
}

function handlePlayGear(
  state: GameState,
  action: GameAction
): ActionResult {
  const { cardInstanceId, targetUnitId, targetBattlefieldId, powerRuneDomains } = action.payload as {
    cardInstanceId: string; targetUnitId?: string; targetBattlefieldId?: string; powerRuneDomains?: Domain[];
  };

  const card = state.allCards[cardInstanceId];
  if (!card || card.location !== 'hand') return { success: false, error: 'Gear not in hand.', action };
  if (card.ownerId !== action.playerId) return { success: false, error: 'Not your card.', action };
  const def = state.cardDefinitions[card.cardId];
  if (def.type !== 'Gear') return { success: false, error: 'Not gear.', action };

  const targetUnit = targetUnitId ? state.allCards[targetUnitId] : undefined;
  const targetBattlefield = targetBattlefieldId
    ? state.battlefields.find(bf => bf.id === targetBattlefieldId)
    : undefined;
  if (!targetUnit && !targetBattlefield) {
    return { success: false, error: 'Gear needs a unit or battlefield target.', action };
  }
  if (targetUnitId && (!targetUnit || targetUnit.ownerId !== action.playerId || targetUnit.location !== 'battlefield')) {
    return { success: false, error: 'Gear target unit not found.', action };
  }
  if (targetBattlefieldId && (!targetBattlefield || targetBattlefield.controllerId !== action.playerId)) {
    return { success: false, error: 'Gear target battlefield not found.', action };
  }

  const newState = deepClone(state);
  const newCard = { ...newState.allCards[cardInstanceId] };
  newState.allCards[cardInstanceId] = newCard;
  const costResult = payCardCosts(newState, action.playerId, def, 0, powerRuneDomains);
  if (!costResult.success) return { success: false, error: costResult.error, action };
  newState.players[action.playerId].hand = newState.players[action.playerId].hand.filter(id => id !== cardInstanceId);

  if (targetUnitId) {
    // Attach to target unit.
    newCard.location = 'equipment';
    newCard.battlefieldId = newState.allCards[targetUnitId].battlefieldId;
    newState.allCards[targetUnitId].attachments.push(cardInstanceId);
    newState.players[action.playerId].equipment[cardInstanceId] = targetUnitId;
  } else if (targetBattlefieldId) {
    // Base/zone gear is associated with the destination battlefield without being attached to a unit.
    newCard.location = 'battlefield';
    newCard.battlefieldId = targetBattlefieldId;
  }

  return { success: true, action, newState };
}

function handleEquipGear(
  state: GameState,
  action: GameAction
): ActionResult {
  // Same as PlayGear for now
  const result = handlePlayGear(state, action);
  if (!result.success || !result.newState) return result;

  // Log equipment attachment
  const { cardInstanceId, targetUnitId } = action.payload as { cardInstanceId: string; targetUnitId?: string };
  const def = state.cardDefinitions[state.allCards[cardInstanceId].cardId];
  const playerName = result.newState.players[action.playerId].name;
  if (targetUnitId) {
    const targetUnitDef = state.cardDefinitions[result.newState.allCards[targetUnitId].cardId];
    result.newState.actionLog.push(makeLog(result.newState, action.playerId, 'Equip',
      `${playerName} equipped ${def.name} to ${targetUnitDef.name}`,
      { gearInstanceId: cardInstanceId, targetUnitId }
    ));
  }

  return result;
}

function handleMoveUnit(
  state: GameState,
  action: GameAction
): ActionResult {
  const { cardInstanceId, cardInstanceIds, fromBattlefieldId, toBattlefieldId } = action.payload as {
    cardInstanceId?: string; cardInstanceIds?: string[]; fromBattlefieldId?: string; toBattlefieldId?: string;
  };

  if (state.phase !== 'Action') {
    return { success: false, error: 'Move actions are only allowed during Action phase.', action };
  }

  const moveUnitIds = cardInstanceIds ?? (cardInstanceId ? [cardInstanceId] : []);
  if (moveUnitIds.length === 0) return { success: false, error: 'No units selected to move.', action };
  if (new Set(moveUnitIds).size !== moveUnitIds.length) {
    return { success: false, error: 'Cannot move the same unit more than once.', action };
  }

  if (!toBattlefieldId) return { success: false, error: 'Destination battlefield not found.', action };
  const toBf = state.battlefields.find(b => b.id === toBattlefieldId);
  if (!toBf) return { success: false, error: 'Destination battlefield not found.', action };
  if (isBaseBattlefieldId(toBattlefieldId) && toBattlefieldId !== getBaseBattlefieldId(action.playerId)) {
    return { success: false, error: 'Units can only move to their controller base.', action };
  }

  const moves: { unitId: string; fromBattlefieldId: string }[] = [];
  for (const unitId of moveUnitIds) {
    const unit = state.allCards[unitId];
    if (!unit) return { success: false, error: 'Unit not found.', action };
    const def = state.cardDefinitions[unit.cardId];
    if (!def || def.type !== 'Unit') return { success: false, error: 'Only units can move.', action };
    if (unit.ownerId !== action.playerId) return { success: false, error: 'Cannot move enemy units.', action };
    if (unit.location !== 'battlefield' || !unit.battlefieldId) {
      return { success: false, error: 'Unit is not at a battlefield or base.', action };
    }
    if (fromBattlefieldId && unit.battlefieldId !== fromBattlefieldId) {
      return { success: false, error: 'Unit is not at the declared origin.', action };
    }
    if (!unit.ready || unit.exhausted) return { success: false, error: 'Unit is exhausted.', action };

    const fromBf = state.battlefields.find(b => b.id === unit.battlefieldId);
    if (!fromBf || !fromBf.units.includes(unitId)) {
      return { success: false, error: 'Origin battlefield not found.', action };
    }
    if (unit.battlefieldId === toBattlefieldId) {
      return { success: false, error: 'Unit is already at that location.', action };
    }

    const fromIsBase = isBaseBattlefieldId(unit.battlefieldId);
    const toIsBase = isBaseBattlefieldId(toBattlefieldId);
    if (fromIsBase && unit.battlefieldId !== getBaseBattlefieldId(action.playerId)) {
      return { success: false, error: 'Units can only move from their controller base.', action };
    }
    if (!fromIsBase && !toIsBase && !(def.keywords ?? []).includes('Ganking')) {
      return { success: false, error: 'Unit does not have Ganking.', action };
    }

    moves.push({ unitId, fromBattlefieldId: unit.battlefieldId });
  }

  const newState = deepClone(state);
  const effects: GameSideEffect[] = [];
  const newToBf = newState.battlefields.find(b => b.id === toBattlefieldId)!;
  for (const move of moves) {
    const newUnit = newState.allCards[move.unitId];
    newUnit.ready = false;
    newUnit.exhausted = true;
    newUnit.battlefieldId = toBattlefieldId;

    const newFromBf = newState.battlefields.find(b => b.id === move.fromBattlefieldId)!;
    newFromBf.units = newFromBf.units.filter(id => id !== move.unitId);
    if (!newToBf.units.includes(move.unitId)) newToBf.units.push(move.unitId);

    effects.push(...resolveAbilities(newState, move.unitId, 'MOVE'));
  }

  const playerName = newState.players[action.playerId].name;
  const fromBf = state.battlefields.find(b => b.id === moves[0].fromBattlefieldId)!;
  const unitNames = moves.map(m => newState.cardDefinitions[newState.allCards[m.unitId].cardId]?.name ?? 'a unit').join(', ');
  newState.actionLog.push(makeLog(newState, action.playerId, 'Move',
    `${playerName} moved ${unitNames} from ${fromBf.name} to ${newToBf.name}`,
    { cardInstanceIds: moves.map(m => m.unitId), fromBattlefieldId: moves[0].fromBattlefieldId, toBattlefieldId }
  ));

  // Check if destination BF is contested — if so, trigger Showdown for each moved unit
  const enemyUnitsAtTarget = newToBf.units.filter(id =>
    newState.allCards[id].ownerId !== action.playerId
  );
  if (enemyUnitsAtTarget.length > 0) {
    // Enter showdown with the first moved unit as attacker (convention)
    const primaryUnitId = moves[0].unitId;
    const showdownState = enterShowdown(newState, primaryUnitId, toBattlefieldId);
    return { success: true, action, newState: showdownState, sideEffects: effects };
  }

  return { success: true, action, newState, sideEffects: effects };
}

function handleAttack(
  state: GameState,
  action: GameAction
): ActionResult {
  const { attackerId, targetBattlefieldId } = action.payload as {
    attackerId: string; targetBattlefieldId: string;
  };

  const attacker = state.allCards[attackerId];
  if (!attacker) return { success: false, error: 'Attacker not found.', action };
  if (!attacker.ready) return { success: false, error: 'Attacker is exhausted.', action };

  const bf = state.battlefields.find(b => b.id === targetBattlefieldId);
  if (!bf) return { success: false, error: 'Target battlefield not found.', action };

  // Move attacker from its current BF to the target BF
  const newState = deepClone(state);
  const fromBf = newState.battlefields.find(b => b.id === attacker.battlefieldId);
  if (fromBf) fromBf.units = fromBf.units.filter(id => id !== attackerId);
  if (!bf.units.includes(attackerId)) bf.units.push(attackerId);
  attacker.battlefieldId = targetBattlefieldId;
  attacker.ready = false;
  attacker.exhausted = true;

  // Enter showdown state (sets phase + ShowdownState)
  const showdownState = enterShowdown(newState, attackerId, targetBattlefieldId);
  return { success: true, action, newState: showdownState };
}

export function resolveShowdown(
  state: GameState,
  attackerId: string,
  targetBattlefieldId: string
): ActionResult {
  const attacker = state.allCards[attackerId];
  const bf = state.battlefields.find(b => b.id === targetBattlefieldId)!;

  const newState = deepClone(state);
  const effects: GameSideEffect[] = [];

  // Gather all units at the battlefield
  const allUnitsAtBf = [...bf.units]; // defender's units
  const attackerOwner = attacker.ownerId;

  // Add attacker to showdown
  const newAttacker = newState.allCards[attackerId];
  newAttacker.ready = false;
  const attackerMight = calculateMight(newState, attackerId);

  // Collect defender units
  const defenderUnitIds = bf.units.filter(id =>
    newState.allCards[id].ownerId !== attackerOwner
  );

  let totalAttackerMight = attackerMight;
  let totalDefenderMight = 0;

  // Apply Assault to attacker
  const def = state.cardDefinitions[attacker.cardId];
  const assaultMatch = def.abilities.find(a => a.effectCode?.startsWith('GIVE_ASSAULT'));
  if (assaultMatch) {
    const match = assaultMatch.effect.match(/\+(\d+)/);
    if (match) totalAttackerMight += parseInt(match[1]);
  }

  // Defender units fight back
  for (const duId of defenderUnitIds) {
    totalDefenderMight += calculateMight(newState, duId);
  }

  // Damage assignment — simplified (attacker vs sum of defenders)
  const survivingAttackers: string[] = [];
  const survivingDefenders: string[] = [];

  if (totalAttackerMight > totalDefenderMight) {
    // Attacker wins
    const excessDamage = totalAttackerMight - totalDefenderMight;

    // Kill defender units (excess damage kills them all for now — simplified)
    for (const duId of defenderUnitIds) {
      const died = takeDamage(newState, duId, 1);
      if (died) {
        effects.push({ type: 'KillUnit', unitInstanceId: duId });
      }
    }

    // Attacker survives
    survivingAttackers.push(attackerId);

    // If defender side is wiped, attacker conquers
    if (defenderUnitIds.every(id => !newState.allCards[id] || newState.allCards[id].location === 'discard')) {
      bf.controllerId = attackerOwner;
      bf.units = bf.units.filter(id => id !== attackerId); // remove attacker for now
      bf.units.push(attackerId); // attacker stays
      bf.scoringSince = newState.turn;
      bf.scoringPlayerId = attackerOwner;
      effects.push({ type: 'ConquerBattlefield', battlefieldId: bf.id, playerId: attackerOwner });
    }
  } else if (totalDefenderMight > totalAttackerMight) {
    // Defenders win — attacker dies
    survivingDefenders.push(...defenderUnitIds);
    const died = takeDamage(newState, attackerId, 1);
    if (died) {
      effects.push({ type: 'KillUnit', unitInstanceId: attackerId });
    }
  } else {
    // Draw — both sides survive but no conquest
    survivingAttackers.push(attackerId);
    survivingDefenders.push(...defenderUnitIds);
  }

  // Check win condition
  const winner = checkWinCondition(newState);
  if (winner) {
    return {
      success: true,
      newState: { ...newState, phase: 'GameOver', winner },
      sideEffects: [...effects, { type: 'GameWin', playerId: winner, reason: 'score' }]
    };
  }

  // Log combat resolution
  const attackerName = newState.cardDefinitions[newState.allCards[attackerId].cardId].name;
  const killedUnitIds = effects.filter(e => e.type === 'KillUnit').map(e => (e as { type: 'KillUnit'; unitInstanceId: string }).unitInstanceId);
  newState.actionLog.push(makeLog(newState, attackerOwner, 'Combat',
    `Combat resolved — ${attackerName} dealt ${totalAttackerMight} might vs ${totalDefenderMight}`,
    { attackerId, defenderIds: defenderUnitIds, damageDealt: totalAttackerMight, unitsKilled: killedUnitIds }
  ));

  const finalState = advancePhase(newState);
  return { success: true, newState: finalState, sideEffects: effects };
}

function calculateMight(state: GameState, unitInstanceId: string): number {
  const unit = state.allCards[unitInstanceId];
  if (!unit) return 0;
  const def = state.cardDefinitions[unit.cardId];
  const base = unit.currentStats.might ?? unit.stats.might ?? 0;
  let total = base;

  // Add gear bonuses
  for (const gearId of unit.attachments) {
    const gear = state.allCards[gearId];
    if (!gear) continue;
    const gearDef = state.cardDefinitions[gear.cardId];
    if (gearDef.stats?.might) total += gearDef.stats.might;
  }

  // Apply keyword modifiers (Assault, Hunt, etc.)
  // For now, Assault is handled at showdown time

  return total;
}

function handleHideCard(state: GameState, action: GameAction): ActionResult {
  const { cardInstanceId } = action.payload as { cardInstanceId: string };
  const card = state.allCards[cardInstanceId];
  if (!card) return { success: false, error: 'Card not found.', action };
  if (card.location !== 'hand') return { success: false, error: 'Card not in hand.', action };

  const def = state.cardDefinitions[card.cardId];
  if (!def.keywords.includes('Hidden')) return { success: false, error: 'Card does not have Hidden.', action };

  const player = state.players[action.playerId];
  const cost = def.cost?.charges ?? 1;
  if (player.charges < cost) return { success: false, error: 'Not enough charges.', action };

  const newState = deepClone(state);
  newState.players[action.playerId].charges -= cost;
  newState.players[action.playerId].hiddenZone.push(cardInstanceId);
  newState.allCards[cardInstanceId].location = 'hidden';
  newState.allCards[cardInstanceId].facing = 'down';
  newState.allCards[cardInstanceId].owner_hidden = true;

  const playerName = newState.players[action.playerId].name;
  newState.actionLog.push(makeLog(newState, action.playerId, 'Hide',
    `${playerName} hid ${def.name}`,
    { cardInstanceId, cardId: def.id }
  ));

  return { success: true, action, newState };
}

function handleReactFromHidden(
  state: GameState,
  action: GameAction
): ActionResult {
  const { cardInstanceId } = action.payload as { cardInstanceId: string };
  const card = state.allCards[cardInstanceId];
  if (!card || card.location !== 'hidden') return { success: false, error: 'Card not in hidden zone.', action };

  const newState = deepClone(state);
  newState.allCards[cardInstanceId].facing = 'up';
  newState.allCards[cardInstanceId].owner_hidden = false;

  const playerName = newState.players[action.playerId].name;
  const def = state.cardDefinitions[card.cardId];
  newState.actionLog.push(makeLog(newState, action.playerId, 'ReactFromHidden',
    `${playerName} revealed ${def.name} from hidden`,
    { cardInstanceId, cardId: def.id }
  ));

  return { success: true, action, newState };
}

function handleUseAbility(
  state: GameState,
  action: GameAction
): ActionResult {
  const { cardInstanceId, abilityIndex, targetId, targetBattlefieldId } = action.payload as {
    cardInstanceId: string; abilityIndex: number; targetId?: string; targetBattlefieldId?: string;
  };

  // --- Showdown: push triggered ability onto stack ---
  if (state.phase === 'Showdown' && state.showdown) {
    const newState = deepClone(state);

    // Must have focus to trigger an ability
    if (state.showdown.focusPlayerId !== action.playerId) {
      return { success: false, error: 'You do not have focus to use an ability.', action };
    }

    const card = state.allCards[cardInstanceId];
    if (!card) return { success: false, error: 'Card not found.', action };
    const def = state.cardDefinitions[card.cardId];
    const ability = def.abilities?.[abilityIndex];
    if (!ability) return { success: false, error: 'Ability not found.', action };

    // Push onto showdown action stack
    pushToActionStack(newState, cardInstanceId, action.playerId, 'ability', ability.effect);

    // Flip focus to opponent
    const opponentId = getOpponentId(newState, action.playerId);
    newState.showdown!.focusPlayerId = opponentId;

    newState.actionLog.push(makeLog(newState, action.playerId, 'Showdown',
      `${newState.players[action.playerId].name} triggered ability: ${ability.effect}`));

    return { success: true, action, newState };
  }

  // --- Normal (non-showdown) ability resolution ---
  const newState = deepClone(state);
  const effects = resolveAbilities(newState, cardInstanceId, 'ABILITY', abilityIndex, targetId, targetBattlefieldId);

  return { success: true, action, newState, sideEffects: effects };
}

function handleConcede(state: GameState, action: GameAction): ActionResult {
  const opponentId = getOpponentId(state, action.playerId);
  const newState = deepClone(state);
  return {
    success: true,
    newState: { ...newState, phase: 'GameOver', winner: opponentId },
    action,
    sideEffects: [{ type: 'GameWin', playerId: opponentId, reason: 'concede' }]
  };
}

function handleMulligan(state: GameState, action: GameAction): ActionResult {
  const { keepIds } = action.payload as { keepIds: string[] };
  const player = state.players[action.playerId];
  const newState = deepClone(state);
  const allPlayerIds = Object.keys(newState.players);

  // Rule 118: a player may set aside up to 2 cards during mulligan.
  const uniqueKeepIds = Array.from(new Set(keepIds)).filter(id => player.hand.includes(id));
  const setAsideIds = player.hand.filter(id => !uniqueKeepIds.includes(id));
  if (setAsideIds.length > 2) {
    return { success: false, error: 'Mulligan: may set aside at most 2 cards.', action };
  }

  newState.players[action.playerId].hand = uniqueKeepIds;

  // Draw replacements before recycling the set-aside cards.
  for (let i = 0; i < setAsideIds.length; i++) {
    const replacementId = newState.players[action.playerId].deck.shift();
    if (!replacementId) break;
    newState.allCards[replacementId].location = 'hand';
    newState.players[action.playerId].hand.push(replacementId);
  }

  // Recycle the set-aside cards by placing them on the bottom of the main deck.
  for (const id of setAsideIds) {
    newState.allCards[id].location = 'deck';
    newState.players[action.playerId].deck.push(id);
  }

  const opponentId = allPlayerIds.find(id => id !== action.playerId);

  // Check if both players have completed mulligan BEFORE marking current player ready
  const bothReady = allPlayerIds
    .filter(id => id !== action.playerId)  // exclude current player
    .every(id => newState.players[id].isReady);

  // Mark current player ready
  newState.players[action.playerId].isReady = true;
  newState.players[action.playerId].mulligansComplete = true;

  // Log mulligan decision
  const playerName = newState.players[action.playerId].name;
  newState.actionLog.push(makeLog(newState, action.playerId, 'Mulligan',
    `${playerName} completed mulligan — kept ${uniqueKeepIds.length}, set aside ${setAsideIds.length}`,
    { kept: uniqueKeepIds.length, setAside: setAsideIds.length }
  ));

  if (bothReady) {
    // Both players have now completed mulligan — transition to first turn
    // First player (hasGoneFirst=true) takes first turn
    const firstPlayerId = allPlayerIds.find(id => newState.players[id].hasGoneFirst) ?? allPlayerIds[0];
    newState.turn = 1;
    // Enter the Awaken phase for the first player
    return {
      success: true,
      action,
      newState: enterPhase({ ...newState, activePlayerId: firstPlayerId, phase: 'Awaken' }, 'Awaken'),
    };
  }

  // Not both ready yet — switch active player to opponent for their mulligan
  return {
    success: true,
    action,
    newState: { ...newState, activePlayerId: opponentId! },
  };
}

// ============================================================
// Ability Resolution
// ============================================================

function getBeginningPhaseTriggers(state: GameState, playerId: string): EffectStackEntry[] {
  const triggers: EffectStackEntry[] = [];
  const startOfBeginningPattern = /(start of .*beginning phase|beginning phase|start of turn)/i;

  for (const card of Object.values(state.allCards)) {
    if (card.ownerId !== playerId) continue;
    if (!['battlefield', 'equipment', 'legend', 'championZone'].includes(card.location)) continue;

    const def = state.cardDefinitions[card.cardId];
    for (const ability of def?.abilities ?? []) {
      const abilityText = `${ability.trigger} ${ability.effect} ${ability.effectCode ?? ''}`;
      if (!startOfBeginningPattern.test(abilityText)) continue;

      triggers.push({
        id: randomId(),
        sourceId: card.instanceId,
        trigger: ability.trigger,
        effect: ability.effect,
        resolves: false,
        triggeredBy: playerId,
      });
    }
  }

  return triggers;
}

function resolveAbilities(
  state: GameState,
  cardInstanceId: string,
  trigger: string,
  abilityIndex?: number,
  targetId?: string,
  targetBattlefieldId?: string
): GameSideEffect[] {
  const card = state.allCards[cardInstanceId];
  if (!card) return [];
  const def = state.cardDefinitions[card.cardId];
  const effects: GameSideEffect[] = [];

  const abilitiesToResolve = abilityIndex !== undefined
    ? [def.abilities[abilityIndex]].filter(Boolean)
    : def.abilities.filter(a => a.trigger === trigger);

  for (const ability of abilitiesToResolve) {
    if (!ability.effectCode) continue;
    const code = ability.effectCode;

    if (code === 'ENTER:GIVE_MIGHT_3') {
      if (targetId) {
        effects.push({ type: 'ApplyModifier', unitInstanceId: targetId, modifier: 'might', value: 3 });
        const unit = state.allCards[targetId];
        if (unit) unit.currentStats.might = (unit.currentStats.might ?? 0) + 3;
      }
    }

    if (code === 'PLAY:DEAL_2_ENEMY') {
      // Find enemy unit at same battlefield
      const bf = state.battlefields.find(b => b.id === card.battlefieldId);
      if (bf) {
        const enemy = bf.units.find(id =>
          state.allCards[id].ownerId !== card.ownerId
        );
        if (enemy) {
          effects.push({ type: 'DamageUnit', unitInstanceId: enemy, damage: 2 });
          const enemyCard = state.allCards[enemy];
          if (enemyCard) {
            enemyCard.currentStats.health = (enemyCard.currentStats.health ?? 1) - 2;
          }
        }
      }
    }

    if (trigger === 'CONQUER_EXCESS_3' || code === 'CONQUER_EXCESS_3:PLAY_GOLD_TOKENS') {
      // Check if this was a conquer with 3+ excess damage
      // Simplified: always trigger for now
      for (let i = 0; i < 2; i++) {
        const goldId = `token_${card.ownerId}_gold_${Date.now()}_${i}`;
        state.allCards[goldId] = {
          instanceId: goldId,
          cardId: 'Gold',
          ownerId: card.ownerId,
          location: 'battlefield',
          battlefieldId: card.battlefieldId,
          ready: false,
          exhausted: true,
          stats: {},
          currentStats: {},
          counters: {},
          attachments: [],
          facing: 'up',
          owner_hidden: false,
          damage: 0,
        };
        const bf = state.battlefields.find(b => b.id === card.battlefieldId);
        if (bf) bf.units.push(goldId);
        effects.push({ type: 'TriggerAbility', cardInstanceId: goldId, trigger: 'token_spawn' });
      }
    }

    if (trigger === 'MOVE' || code === 'MOVE:ADD_CHARGE_1') {
      const p = state.players[card.ownerId];
      if (p) p.charges += 1;
      effects.push({ type: 'ReadyPlayer', playerId: card.ownerId });
    }

    if (code.startsWith('READY_UNIT') || trigger === 'READY') {
      if (targetId) {
        effects.push({ type: 'ReadyUnit', unitInstanceId: targetId });
        const unit = state.allCards[targetId];
        if (unit) unit.ready = true;
      }
    }
  }

  return effects;
}

function resolveSpellEffect(
  state: GameState,
  cardInstanceId: string,
  targetId?: string,
  targetBattlefieldId?: string
): GameSideEffect[] {
  const card = state.allCards[cardInstanceId];
  if (!card) return [];
  const def = state.cardDefinitions[card.cardId];
  const effects: GameSideEffect[] = [];

  for (const ability of def.abilities) {
    const code = ability.effectCode ?? ability.trigger;
    const targetCard = targetId ? state.allCards[targetId] : null;

    if (code.includes('DEAL_3') || code.includes('DEAL_3_BANISH_ON_DEATH')) {
      if (targetCard) {
        const died = takeDamage(state, targetId!, 3);
        effects.push({ type: 'DamageUnit', unitInstanceId: targetId!, damage: 3 });
      }
    }

    if (code.includes('DEAL_2_OR_4_FACEDOWN')) {
      // Check if player controls a facedown card
      const hasFacedown = Object.values(state.players).some(p =>
        p.hiddenZone.length > 0
      );
      const damage = hasFacedown ? 4 : 2;
      if (targetCard) {
        const died = takeDamage(state, targetId!, damage);
        effects.push({ type: 'DamageUnit', unitInstanceId: targetId!, damage });
      }
    }

    if (code.includes('READY_UNIT') || code.includes('GIVE_ASSAULT')) {
      // Square Up / Vault Breaker
      if (targetCard && targetCard.location === 'battlefield') {
        effects.push({ type: 'ReadyUnit', unitInstanceId: targetId! });
        targetCard.ready = true;
      }
    }

    if (code.includes('GIVE_ASSAULT')) {
      if (targetCard) {
        effects.push({ type: 'ApplyModifier', unitInstanceId: targetId!, modifier: 'assault', value: 2 });
      }
    }
  }

  return effects;
}

// ============================================================
// Helpers
// ============================================================

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function getOpponentId(state: GameState, playerId: string): string {
  return Object.keys(state.players).find(pid => pid !== playerId) ?? playerId;
}

function getUnitOwner(state: GameState, unitInstanceId: string): string {
  return state.allCards[unitInstanceId]?.ownerId ?? '';
}

function makeLog(state: GameState, playerId: string, logType: LogEntryType, message: string, detail?: Record<string, unknown>): SystemLogEntry {
  return {
    id: randomId(),
    type: logType,
    playerId,
    message,
    turn: state.turn,
    phase: state.phase,
    timestamp: Date.now(),
    detail,
  };
}

// ============================================================
// AI Move Generation
// ============================================================

export function getLegalActions(state: GameState, playerId: string): GameAction[] {
  const actions: GameAction[] = [];
  if (state.phase === 'GameOver') return actions;

  const player = state.players[playerId];
  if (!player) return actions;

  // Mulligan is legal during Mulligan phase for the active player who hasn't completed it yet
  if (state.phase === 'Mulligan' && state.activePlayerId === playerId && !player.mulligansComplete) {
    actions.push(makeAction('Mulligan', playerId, { keepIds: [...player.hand] }));
  }

  // Pass is legal during the Action phase.
  if (state.phase === 'Action') {
    actions.push(makeAction('Pass', playerId, {}));
  }

  // Play units from hand
  for (const cardId of player.hand) {
    const card = state.allCards[cardId];
    if (!card) continue;
    const def = state.cardDefinitions[card.cardId];

    if (def.type === 'Unit' && canPayCardCosts(state, playerId, def)) {
      const powerRuneDomains = buildAutoPowerRuneDomains(def);
      for (const bf of state.battlefields) {
        // In MVP, can play to any BF where you have units (or it's unoccupied)
        if (bf.controllerId === playerId || bf.units.some(id => state.allCards[id]?.ownerId === playerId)) {
          actions.push(makeAction('PlayUnit', playerId, { cardInstanceId: cardId, battlefieldId: bf.id, hidden: false, accelerate: false, powerRuneDomains }));
          if (def.keywords.includes('Accelerate') && canPayCardCosts(state, playerId, def, 1)) {
            actions.push(makeAction('PlayUnit', playerId, { cardInstanceId: cardId, battlefieldId: bf.id, hidden: false, accelerate: true, powerRuneDomains }));
          }
        }
      }
    }

    if (def.type === 'Spell' && canPayCardCosts(state, playerId, def)) {
      actions.push(makeAction('PlaySpell', playerId, { cardInstanceId: cardId, powerRuneDomains: buildAutoPowerRuneDomains(def) }));
    }

    if (def.type === 'Gear' && canPayCardCosts(state, playerId, def)) {
      const base = state.battlefields.find(bf => bf.id === getBaseBattlefieldId(playerId));
      if (base) {
        actions.push(makeAction('PlayGear', playerId, { cardInstanceId: cardId, targetBattlefieldId: base.id, powerRuneDomains: buildAutoPowerRuneDomains(def) }));
      }
      for (const bf of state.battlefields) {
        if (isBaseBattlefieldId(bf.id)) continue;
        const myUnits = bf.units.filter(id => state.allCards[id]?.ownerId === playerId);
        for (const unitId of myUnits) {
          actions.push(makeAction('PlayGear', playerId, { cardInstanceId: cardId, targetUnitId: unitId, powerRuneDomains: buildAutoPowerRuneDomains(def) }));
        }
      }
    }
  }

  // Move units
  for (const bf of state.battlefields) {
    for (const unitId of bf.units) {
      const unit = state.allCards[unitId];
      if (!unit || unit.ownerId !== playerId || !unit.ready || unit.exhausted) continue;
      const def = state.cardDefinitions[unit.cardId];

      for (const targetBf of state.battlefields) {
        if (targetBf.id === bf.id) continue;
        if (isBaseBattlefieldId(targetBf.id) && targetBf.id !== getBaseBattlefieldId(playerId)) continue;
        if (isBaseBattlefieldId(bf.id) && bf.id !== getBaseBattlefieldId(playerId)) continue;
        if (!isBaseBattlefieldId(bf.id) && !isBaseBattlefieldId(targetBf.id) && !(def.keywords ?? []).includes('Ganking')) continue;
        actions.push(makeAction('MoveUnit', playerId, {
          cardInstanceId: unitId,
          fromBattlefieldId: bf.id,
          toBattlefieldId: targetBf.id,
        }));
      }
    }
  }

  // Attack
  for (const bf of state.battlefields) {
    if (isBaseBattlefieldId(bf.id)) continue;
    for (const unitId of bf.units) {
      const unit = state.allCards[unitId];
      if (!unit || unit.ownerId !== playerId || !unit.ready) continue;
      // Can attack any BF (including your own if you want to score)
      if (bf.id !== unit.battlefieldId) { // Can't attack from same BF
        actions.push(makeAction('Attack', playerId, { attackerId: unitId, targetBattlefieldId: bf.id }));
      }
    }
  }

  return actions;
}

function makeAction(type: ActionType, playerId: string, payload: Record<string, unknown>): GameAction {
  return {
    id: randomId(),
    type,
    playerId,
    payload,
    turn: 0,
    phase: 'Action',
    timestamp: Date.now(),
  };
}

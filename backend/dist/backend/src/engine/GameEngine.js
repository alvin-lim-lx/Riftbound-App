"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGame = createGame;
exports.executeAction = executeAction;
exports.canAutoAdvancePhase = canAutoAdvancePhase;
exports.advancePhase = advancePhase;
exports.startNewTurn = startNewTurn;
exports.enterPhase = enterPhase;
exports.checkScoring = checkScoring;
exports.checkWinCondition = checkWinCondition;
exports.resolveShowdown = resolveShowdown;
exports.deepClone = deepClone;
exports.getLegalActions = getLegalActions;
const cards_1 = require("../../shared/src/cards");
const utils_1 = require("./utils");
function createGame(playerIds, playerNames, options = {}) {
    const { scoreLimit = 8, isPvP = true, playerDecks } = options;
    // Determine first player's deck config (for battlefield/rune settings)
    const firstDeckConfig = playerDecks?.[playerIds[0]];
    // Create battlefields
    // If a deck config is provided with battlefieldIds, use those (first is starting bf)
    // Otherwise fall back to default 3 battlefields
    // Mapping from logical battlefield names to real card IDs in CARDS
    const BF_ID_MAP = {
        'Baron_Pit': 'unl-t01',
        'Brush': 'unl-t03',
        // 'The_Grid' doesn't exist in CARDS — use Power Nexus as a substitute
        'The_Grid': 'sfd-214-221',
    };
    const resolveBfCardId = (id) => BF_ID_MAP[id] ?? id;
    let battlefields;
    if (firstDeckConfig?.battlefieldIds && firstDeckConfig.battlefieldIds.length >= 1) {
        const bfCardIds = firstDeckConfig.battlefieldIds.slice(0, 3);
        // Pad with defaults if fewer than 3
        const defaults = ['Baron_Pit', 'Brush', 'The_Grid'];
        while (bfCardIds.length < 3)
            bfCardIds.push(defaults[bfCardIds.length]);
        // Create all 3 battlefields from the deck config
        battlefields = bfCardIds.map((rawCardId, i) => {
            const cardId = resolveBfCardId(rawCardId);
            return {
                id: `bf_${i}`,
                name: cards_1.CARDS[cardId]?.name ?? rawCardId,
                cardId,
                controllerId: null,
                units: [],
                scoringSince: null,
                scoringPlayerId: null,
            };
        });
    }
    else {
        const battlefieldDefs = ['Baron_Pit', 'Brush'];
        battlefields = battlefieldDefs.map((rawCardId, i) => {
            const cardId = resolveBfCardId(rawCardId);
            return {
                id: `bf_${i}`,
                name: cards_1.CARDS[cardId]?.name ?? rawCardId,
                cardId,
                controllerId: null,
                units: [],
                scoringSince: null,
                scoringPlayerId: null,
            };
        });
        const gridCardId = resolveBfCardId('The_Grid');
        battlefields.push({
            id: 'bf_2',
            name: cards_1.CARDS[gridCardId]?.name ?? 'The Grid',
            cardId: gridCardId,
            controllerId: null,
            units: [],
            scoringSince: null,
            scoringPlayerId: null,
        });
    }
    // Create rune decks and initial hands for each player
    const allCards = {};
    const players = {};
    playerIds.forEach((pid, idx) => {
        // Determine deck card ids — use provided deck config or fallback to all cards
        let deckCardIds;
        const deckConfig = playerDecks?.[pid];
        if (deckConfig) {
            // 40 cards in cardIds: includes the Chosen Champion (1 copy)
            // Extract champion → Champion Zone; remaining 39 → shuffled into deck (no duplication)
            const championId = deckConfig.chosenChampionCardId;
            deckCardIds = deckConfig.cardIds.filter(id => id !== championId);
            // deckCardIds is now 39 cards — use as-is, don't duplicate
        }
        else {
            // Fallback: use all Unit/Spell/Gear cards from the database
            const unitCardIds = Object.keys(cards_1.CARDS).filter(id => ['Unit', 'Spell', 'Gear'].includes(cards_1.CARDS[id].type));
            deckCardIds = [];
            for (const cardId of unitCardIds) {
                deckCardIds.push(cardId, cardId);
            }
        }
        deckCardIds = (0, utils_1.shuffle)(deckCardIds);
        const deckInstanceIds = [];
        for (const cardId of deckCardIds) {
            const instId = `${pid}_deck_${(0, utils_1.randomId)()}`;
            const cardDef = cards_1.CARDS[cardId];
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
        let runeDeckIds = [];
        if (deckConfig?.runeIds && deckConfig.runeIds.length > 0) {
            // Use actual rune cards from deck config
            for (const runeCardId of deckConfig.runeIds) {
                const rid = `${pid}_rune_${(0, utils_1.randomId)()}`;
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
                };
                runeDeckIds.push(rid);
            }
        }
        else {
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
                };
                runeDeckIds.push(runeId);
            }
        }
        // Place Champion Legend in Legend Zone (Rule 112 / 103.1.a)
        let legendInstanceId = null;
        if (deckConfig?.legendId) {
            const legendDef = cards_1.CARDS[deckConfig.legendId];
            if (legendDef) {
                const lid = `${pid}_legend_${(0, utils_1.randomId)()}`;
                allCards[lid] = {
                    instanceId: lid,
                    cardId: deckConfig.legendId,
                    ownerId: pid,
                    location: 'legend', // Legend Zone — not in hand
                    ready: false,
                    exhausted: false,
                    stats: legendDef.stats ? { ...legendDef.stats } : {},
                    currentStats: legendDef.stats ? { ...legendDef.stats } : {},
                    counters: {},
                    attachments: [],
                    facing: 'up',
                    owner_hidden: false,
                };
                legendInstanceId = lid;
            }
        }
        // Place Chosen Champion in Champion Zone (Rule 113 / 103.2.a)
        let chosenChampionInstanceId = null;
        if (deckConfig?.chosenChampionCardId) {
            const champDef = cards_1.CARDS[deckConfig.chosenChampionCardId];
            if (champDef) {
                const cid = `${pid}_champion_${(0, utils_1.randomId)()}`;
                allCards[cid] = {
                    instanceId: cid,
                    cardId: deckConfig.chosenChampionCardId,
                    ownerId: pid,
                    location: 'championZone', // Champion Zone — not in hand
                    ready: false,
                    exhausted: false,
                    stats: champDef.stats ? { ...champDef.stats } : {},
                    currentStats: champDef.stats ? { ...champDef.stats } : {},
                    counters: {},
                    attachments: [],
                    facing: 'up',
                    owner_hidden: false,
                };
                chosenChampionInstanceId = cid;
            }
        }
        // Build PlayerState with all required fields
        players[pid] = {
            id: pid,
            name: playerNames[idx] ?? `Player ${idx + 1}`,
            hand: handInstanceIds, // 4 cards — Legend and Chosen Champion are NOT here
            deck: deckInstanceIds,
            runeDeck: runeDeckIds, // 12 runes
            runeDiscard: [],
            discardPile: [],
            score: 0,
            xp: 0,
            equipment: {},
            hiddenZone: [],
            isReady: false,
            mana: 0,
            maxMana: 0,
            charges: 0,
            legend: legendInstanceId,
            chosenChampion: chosenChampionInstanceId,
            hasGoneFirst: false,
            mulligansComplete: false,
        };
    });
    // Determine first player randomly (Rule 116) — flip a coin
    const firstPlayerIdx = Math.floor(Math.random() * playerIds.length);
    const firstPlayerId = playerIds[firstPlayerIdx];
    return {
        id: `game_${(0, utils_1.randomId)()}`,
        turn: 0,
        phase: 'Setup',
        activePlayerId: firstPlayerId,
        players,
        battlefields,
        allCards,
        cardDefinitions: cards_1.CARDS,
        winner: null,
        scoreLimit,
        actionLog: [
            {
                id: (0, utils_1.randomId)(),
                type: 'GameStart',
                message: `Game started — ${playerNames[0]} vs ${playerNames[1]}`,
                turn: 0,
                phase: 'Setup',
                timestamp: Date.now(),
            }
        ],
        createdAt: Date.now(),
        isPvP,
        effectStack: [], // empty effect stack at game start
    };
}
// ============================================================
// Engine Entry Point
// ============================================================
function executeAction(state, action) {
    // Validate it's this player's turn
    if (action.playerId !== state.activePlayerId) {
        return { success: false, error: 'Not your turn.', action };
    }
    // Route to handler
    switch (action.type) {
        case 'Pass': {
            const result = handlePass(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'PlayUnit': {
            const result = handlePlayUnit(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'PlaySpell': {
            const result = handlePlaySpell(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'PlayGear': {
            const result = handlePlayGear(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'EquipGear': {
            const result = handleEquipGear(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'MoveUnit': {
            const result = handleMoveUnit(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'Attack': {
            const result = handleAttack(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'DrawRune': {
            const result = handleDrawRune(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'UseRune': {
            const result = handleUseRune(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'HideCard': {
            const result = handleHideCard(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'ReactFromHidden': {
            const result = handleReactFromHidden(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'UseAbility': {
            const result = handleUseAbility(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'Concede': {
            const result = handleConcede(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        case 'Mulligan': {
            const result = handleMulligan(state, action);
            if (result.success && result.newState)
                result.newState.actionLog.push(action);
            return result;
        }
        default:
            return { success: false, error: `Unknown action type: ${action.type}`, action };
    }
}
// ============================================================
// Turn & Phase Management
// ============================================================
const PHASE_ORDER = [
    'Awaken', 'Beginning', 'Channel', 'Draw', 'Action', 'End'
];
// Phases that auto-advance when the effect stack is empty
const AUTO_ADVANCE_PHASES = ['Awaken', 'Beginning', 'Channel', 'Draw'];
function canAutoAdvancePhase(state) {
    // Only auto-advance A-B-C-D phases
    if (!AUTO_ADVANCE_PHASES.includes(state.phase)) {
        return false;
    }
    // Only auto-advance when the effect stack is empty (defensive: treat undefined as empty)
    const result = !state.effectStack || state.effectStack.length === 0;
    console.log(`[canAutoAdvance] phase=${state.phase} effectStackLen=${state.effectStack?.length} result=${result}`);
    return result;
}
function advancePhase(state) {
    // DEBUG
    const dbgPhase = state.phase;
    // Handle Action sub-phases
    if (state.phase === 'FirstMain') {
        const next = enterPhase(state, 'Combat');
        return withPhaseLog(next, 'FirstMain', 'Combat');
    }
    if (state.phase === 'Combat') {
        const next = enterPhase(state, 'SecondMain');
        return withPhaseLog(next, 'Combat', 'SecondMain');
    }
    if (state.phase === 'SecondMain') {
        // End of action phase — advance to End
        const next = enterPhase(state, 'End');
        return withPhaseLog(next, 'SecondMain', 'End');
    }
    const currentIdx = PHASE_ORDER.indexOf(state.phase);
    if (currentIdx === -1)
        return state;
    // Auto-advance through A-B-C-D phases when effect stack is empty
    if (canAutoAdvancePhase(state)) {
        if (currentIdx < PHASE_ORDER.length - 1) {
            const nextPhase = PHASE_ORDER[currentIdx + 1];
            const nextState = enterPhase(state, nextPhase);
            // After entering next phase, check if THAT phase also auto-advances.
            // Only recurse if the phase we entered is still an A-B-C-D phase AND
            // the CURRENT phase still has an empty stack (checking again after the
            // enterPhase call in case that call pushed an effect to the stack).
            if (AUTO_ADVANCE_PHASES.includes(nextPhase)
                && canAutoAdvancePhase(nextState)
                && canAutoAdvancePhase(state)) {
                return advancePhase(nextState);
            }
            return nextState;
        }
        else {
            // End of turn — start new turn
            return startNewTurn(state);
        }
    }
    // Stack non-empty or non-auto-advance phase: enter next phase (await player input)
    if (currentIdx < PHASE_ORDER.length - 1) {
        const nextPhase = PHASE_ORDER[currentIdx + 1];
        const next = enterPhase(state, nextPhase);
        return withPhaseLog(next, state.phase, nextPhase);
    }
    else {
        return startNewTurn(state);
    }
}
function withPhaseLog(state, fromPhase, toPhase) {
    const newState = deepClone(state);
    newState.actionLog.push(makeLog(newState, newState.activePlayerId, 'PhaseChange', `Phase changed from ${fromPhase} to ${toPhase}`));
    return newState;
}
function startNewTurn(state) {
    const nextPlayerId = getOpponentId(state, state.activePlayerId);
    const newState = deepClone(state);
    newState.turn = state.turn + 1;
    newState.activePlayerId = nextPlayerId;
    newState.effectStack = (state.effectStack ?? []).slice(); // clear effect stack on new turn
    newState.actionLog.push(makeLog(newState, nextPlayerId, 'TurnChange', `Turn ${newState.turn} begins for ${nextPlayerId}`));
    return enterPhase(newState, 'Awaken');
}
function enterPhase(state, phase) {
    const newState = { ...state, phase };
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
            // Action is a parent phase — enter FirstMain sub-phase
            return enterPhase(newState, 'FirstMain');
        case 'FirstMain':
        case 'Combat':
        case 'SecondMain':
            // Sub-phases of Action — no special entry behavior
            return newState;
        case 'End':
            return executeEndPhase(newState);
        default:
            return newState;
    }
}
function executeSetupPhase(state) {
    // Rule 101: Setup Phase
    // - Players place their Legend in the Legend Zone
    // - Players place their Chosen Champion in the Champion Zone
    // - Shuffle both main deck and rune deck
    // - Draw opening hand of 4 cards
    // All of this is already done in createGame().
    // Transition directly to Mulligan phase.
    return enterPhase(state, 'Mulligan');
}
function executeMulliganPhase(state) {
    // Mulligan phase: each player takes turns deciding which cards to keep.
    // Rule 116 / 117 / 118: Players may mulligan once per game.
    // The activePlayerId at this point is the player who chose first (hasGoneFirst=true).
    // They get the first mulligan action.
    return state;
}
function executeAwakenPhase(state) {
    const playerId = state.activePlayerId;
    const newState = deepClone(state);
    const player = newState.players[playerId];
    // Reset mana and charges (Awaken behavior)
    player.mana = 2;
    player.maxMana = 2;
    player.charges = 1;
    // Ready all units at battlefields (Awaken behavior)
    for (const bf of newState.battlefields) {
        for (const unitId of bf.units) {
            newState.allCards[unitId].ready = true;
            newState.allCards[unitId].exhausted = false;
        }
    }
    return newState;
}
function executeBeginningPhase(state) {
    const playerId = state.activePlayerId;
    const newState = deepClone(state);
    // Score from Hold — check each battlefield
    for (const bf of newState.battlefields) {
        if (bf.controllerId && bf.units.length > 0 && bf.scoringSince !== null) {
            // Player has held battlefield with units all turn
            const holder = newState.players[bf.scoringPlayerId];
            holder.score += 1;
            newState.actionLog.push(makeLog(newState, bf.scoringPlayerId, 'Score', `Scored 1 point from ${bf.name}`));
        }
    }
    return newState;
}
function executeChannelPhase(state) {
    const playerId = state.activePlayerId;
    const newState = deepClone(state);
    const player = newState.players[playerId];
    // Channel 2 Runes from Rune Deck into Rune Pool (top bar)
    for (let i = 0; i < 2; i++) {
        const runeId = player.runeDeck.shift();
        if (runeId) {
            // Set location to 'rune' (active rune pool visible in top bar)
            newState.allCards[runeId].location = 'rune';
        }
    }
    return newState;
}
function executeDrawPhase(state) {
    const playerId = state.activePlayerId;
    const newState = deepClone(state);
    const player = newState.players[playerId];
    // Draw 1 card from Main Deck
    const cardId = player.deck.shift();
    if (cardId) {
        newState.allCards[cardId].location = 'hand';
        player.hand.push(cardId);
    }
    // Clear Rune Pool (discard all runes from rune pool)
    const runeIds = Object.keys(newState.allCards).filter(id => newState.allCards[id].ownerId === playerId && newState.allCards[id].location === 'rune');
    for (const runeId of runeIds) {
        newState.allCards[runeId].location = 'runeDiscard';
        player.runeDiscard.push(runeId);
    }
    return newState;
}
function executeCombatPhase(state) {
    // Combat is entered but resolves when Attack action is taken
    return state;
}
function executeEndPhase(state) {
    const newState = deepClone(state);
    // Kill Temporary units (End of Turn behavior)
    for (const bf of newState.battlefields) {
        const toKill = [];
        for (const unitId of bf.units) {
            const unit = newState.allCards[unitId];
            if (!unit)
                continue;
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
function checkScoring(state) {
    for (const bf of state.battlefields) {
        if (!bf.controllerId)
            continue;
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
function checkWinCondition(state) {
    for (const [pid, player] of Object.entries(state.players)) {
        if (player.score >= state.scoreLimit) {
            return pid;
        }
    }
    return null;
}
// ============================================================
// Action Handlers
// ============================================================
function handlePass(state, action) {
    const newState = advancePhase(deepClone(state));
    return { success: true, action, newState };
}
function handlePlayUnit(state, action) {
    const { cardInstanceId, battlefieldId, hidden, accelerate } = action.payload;
    const card = state.allCards[cardInstanceId];
    if (!card)
        return { success: false, error: 'Card not found.', action };
    if (card.location !== 'hand')
        return { success: false, error: 'Card not in hand.', action };
    if (card.ownerId !== action.playerId)
        return { success: false, error: 'Not your card.', action };
    const def = state.cardDefinitions[card.cardId];
    if (def.type !== 'Unit')
        return { success: false, error: 'Not a unit.', action };
    if (!def.cost)
        return { success: false, error: 'No cost defined.', action };
    const player = state.players[action.playerId];
    const manaCost = def.cost.rune;
    const accelCost = accelerate ? 1 : 0;
    if (player.mana < manaCost + accelCost)
        return { success: false, error: 'Not enough mana.', action };
    const bf = state.battlefields.find(b => b.id === battlefieldId);
    if (!bf)
        return { success: false, error: 'Battlefield not found.', action };
    const newState = deepClone(state);
    newState.allCards[cardInstanceId] = { ...newState.allCards[cardInstanceId] };
    const newCard = newState.allCards[cardInstanceId];
    // Pay costs
    newState.players[action.playerId].mana -= (manaCost + accelCost);
    // Remove from hand
    newState.players[action.playerId].hand = newState.players[action.playerId].hand.filter(id => id !== cardInstanceId);
    // Move to battlefield
    newCard.location = 'battlefield';
    newCard.battlefieldId = battlefieldId;
    newCard.facing = hidden ? 'down' : 'up';
    newCard.owner_hidden = hidden;
    bf.units.push(cardInstanceId);
    // Ambush check — if card has Ambush, it can be played during showdown
    // For now, units played in FirstMain enter ready if no Accelerate
    const hasAccelerate = def.keywords.includes('Accelerate');
    if (accelerate && hasAccelerate) {
        newCard.ready = true;
    }
    else {
        newCard.ready = false;
    }
    // Trigger play abilities
    const effects = resolveAbilities(newState, cardInstanceId, 'PLAY');
    return { success: true, action, newState, sideEffects: effects };
}
function handlePlaySpell(state, action) {
    const { cardInstanceId, targetId, targetBattlefieldId } = action.payload;
    const card = state.allCards[cardInstanceId];
    if (!card)
        return { success: false, error: 'Card not found.', action };
    if (card.location !== 'hand')
        return { success: false, error: 'Card not in hand.', action };
    const def = state.cardDefinitions[card.cardId];
    if (def.type !== 'Spell')
        return { success: false, error: 'Not a spell.', action };
    const player = state.players[action.playerId];
    const cost = def.cost?.rune ?? 0;
    if (player.mana < cost)
        return { success: false, error: 'Not enough mana.', action };
    const newState = deepClone(state);
    newState.allCards[cardInstanceId] = { ...newState.allCards[cardInstanceId] };
    const newCard = newState.allCards[cardInstanceId];
    // Pay cost
    newState.players[action.playerId].mana -= cost;
    newState.players[action.playerId].hand = newState.players[action.playerId].hand.filter(id => id !== cardInstanceId);
    newCard.location = 'discard';
    newState.players[action.playerId].discardPile.push(cardInstanceId);
    // Resolve spell effects
    const effects = resolveSpellEffect(newState, cardInstanceId, targetId, targetBattlefieldId);
    return { success: true, action, newState, sideEffects: effects };
}
function handlePlayGear(state, action) {
    const { cardInstanceId, targetUnitId } = action.payload;
    const card = state.allCards[cardInstanceId];
    if (!card || card.location !== 'hand')
        return { success: false, error: 'Gear not in hand.', action };
    const def = state.cardDefinitions[card.cardId];
    if (def.type !== 'Gear')
        return { success: false, error: 'Not gear.', action };
    const player = state.players[action.playerId];
    const cost = def.cost?.rune ?? 0;
    if (player.mana < cost)
        return { success: false, error: 'Not enough mana.', action };
    const newState = deepClone(state);
    const newCard = { ...newState.allCards[cardInstanceId] };
    newState.allCards[cardInstanceId] = newCard;
    newState.players[action.playerId].mana -= cost;
    newState.players[action.playerId].hand = newState.players[action.playerId].hand.filter(id => id !== cardInstanceId);
    // Attach to target unit
    newCard.location = 'equipment';
    newCard.battlefieldId = newState.allCards[targetUnitId].battlefieldId;
    newState.allCards[targetUnitId].attachments.push(cardInstanceId);
    newState.players[action.playerId].equipment[cardInstanceId] = targetUnitId;
    return { success: true, action, newState };
}
function handleEquipGear(state, action) {
    // Same as PlayGear for now
    return handlePlayGear(state, action);
}
function handleMoveUnit(state, action) {
    const { cardInstanceId, fromBattlefieldId, toBattlefieldId } = action.payload;
    const unit = state.allCards[cardInstanceId];
    if (!unit)
        return { success: false, error: 'Unit not found.', action };
    if (!unit.ready)
        return { success: false, error: 'Unit is exhausted.', action };
    const def = state.cardDefinitions[unit.cardId];
    if (!def.keywords.includes('Ganking')) {
        return { success: false, error: 'Unit does not have Ganking.', action };
    }
    const fromBf = state.battlefields.find(b => b.id === fromBattlefieldId);
    const toBf = state.battlefields.find(b => b.id === toBattlefieldId);
    if (!fromBf || !toBf)
        return { success: false, error: 'Battlefield not found.', action };
    if (!state.battlefields.find(b => b.id === toBattlefieldId)?.controllerId) {
        // Can't move to unconquered BFs unless you have units there or it's neutral
    }
    const newState = deepClone(state);
    const newUnit = newState.allCards[cardInstanceId];
    newUnit.ready = false; // Moving exhausts
    newUnit.battlefieldId = toBattlefieldId;
    const newFromBf = newState.battlefields.find(b => b.id === fromBattlefieldId);
    const newToBf = newState.battlefields.find(b => b.id === toBattlefieldId);
    newFromBf.units = newFromBf.units.filter(id => id !== cardInstanceId);
    newToBf.units.push(cardInstanceId);
    // Trigger ability if any (e.g. Jhin: "When I move, Add 1 charge")
    const effects = resolveAbilities(newState, cardInstanceId, 'MOVE');
    return { success: true, action, newState, sideEffects: effects };
}
function handleAttack(state, action) {
    const { attackerId, targetBattlefieldId } = action.payload;
    const attacker = state.allCards[attackerId];
    if (!attacker)
        return { success: false, error: 'Attacker not found.', action };
    if (!attacker.ready)
        return { success: false, error: 'Attacker is exhausted.', action };
    const bf = state.battlefields.find(b => b.id === targetBattlefieldId);
    if (!bf)
        return { success: false, error: 'Target battlefield not found.', action };
    const newState = deepClone(state);
    newState.phase = 'Showdown';
    return { success: true, action, newState };
}
function resolveShowdown(state, attackerId, targetBattlefieldId) {
    const attacker = state.allCards[attackerId];
    const bf = state.battlefields.find(b => b.id === targetBattlefieldId);
    const newState = deepClone(state);
    const effects = [];
    // Gather all units at the battlefield
    const allUnitsAtBf = [...bf.units]; // defender's units
    const attackerOwner = attacker.ownerId;
    // Add attacker to showdown
    const newAttacker = newState.allCards[attackerId];
    newAttacker.ready = false;
    const attackerMight = calculateMight(newState, attackerId);
    // Collect defender units
    const defenderUnitIds = bf.units.filter(id => newState.allCards[id].ownerId !== attackerOwner);
    let totalAttackerMight = attackerMight;
    let totalDefenderMight = 0;
    // Apply Assault to attacker
    const def = state.cardDefinitions[attacker.cardId];
    const assaultMatch = def.abilities.find(a => a.effectCode?.startsWith('GIVE_ASSAULT'));
    if (assaultMatch) {
        const match = assaultMatch.effect.match(/\+(\d+)/);
        if (match)
            totalAttackerMight += parseInt(match[1]);
    }
    // Defender units fight back
    for (const duId of defenderUnitIds) {
        totalDefenderMight += calculateMight(newState, duId);
    }
    // Damage assignment — simplified (attacker vs sum of defenders)
    const survivingAttackers = [];
    const survivingDefenders = [];
    if (totalAttackerMight > totalDefenderMight) {
        // Attacker wins
        const excessDamage = totalAttackerMight - totalDefenderMight;
        // Kill defender units (excess damage kills them all for now — simplified)
        for (const duId of defenderUnitIds) {
            const defender = newState.allCards[duId];
            const defHp = defender.currentStats.health ?? defender.stats.health ?? 1;
            defender.currentStats.health = defHp - 1;
            if (defender.currentStats.health <= 0) {
                effects.push({ type: 'KillUnit', unitInstanceId: duId });
                bf.units = bf.units.filter(id => id !== duId);
                defender.location = 'discard';
                const pOwner = defender.ownerId;
                newState.players[pOwner].discardPile.push(duId);
            }
        }
        // Attacker survives
        survivingAttackers.push(attackerId);
        // If defender side is wiped, attacker conquers
        if (defenderUnitIds.every(id => (newState.allCards[id]?.currentStats.health ?? 0) <= 0)) {
            bf.controllerId = attackerOwner;
            bf.units = bf.units.filter(id => id !== attackerId); // remove attacker for now
            bf.units.push(attackerId); // attacker stays
            bf.scoringSince = newState.turn;
            bf.scoringPlayerId = attackerOwner;
            effects.push({ type: 'ConquerBattlefield', battlefieldId: bf.id, playerId: attackerOwner });
        }
    }
    else if (totalDefenderMight > totalAttackerMight) {
        // Defenders win — attacker dies
        survivingDefenders.push(...defenderUnitIds);
        const attackerHp = newAttacker.currentStats.health ?? newAttacker.stats.health ?? 1;
        newAttacker.currentStats.health = attackerHp - 1;
        if (newAttacker.currentStats.health <= 0) {
            effects.push({ type: 'KillUnit', unitInstanceId: attackerId });
            const fromBf = newState.battlefields.find(b => b.id === newAttacker.battlefieldId);
            if (fromBf)
                fromBf.units = fromBf.units.filter(id => id !== attackerId);
            newAttacker.location = 'discard';
            newState.players[attackerOwner].discardPile.push(attackerId);
        }
    }
    else {
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
    const finalState = advancePhase(newState);
    return { success: true, newState: finalState, sideEffects: effects };
}
function calculateMight(state, unitInstanceId) {
    const unit = state.allCards[unitInstanceId];
    if (!unit)
        return 0;
    const def = state.cardDefinitions[unit.cardId];
    const base = unit.currentStats.might ?? unit.stats.might ?? 0;
    let total = base;
    // Add gear bonuses
    for (const gearId of unit.attachments) {
        const gear = state.allCards[gearId];
        if (!gear)
            continue;
        const gearDef = state.cardDefinitions[gear.cardId];
        if (gearDef.stats?.might)
            total += gearDef.stats.might;
    }
    // Apply keyword modifiers (Assault, Hunt, etc.)
    // For now, Assault is handled at showdown time
    return total;
}
function handleDrawRune(state, action) {
    const player = state.players[action.playerId];
    const runeId = player.runeDeck.shift();
    if (!runeId)
        return { success: false, error: 'No runes left.', action };
    const newState = deepClone(state);
    newState.allCards[runeId].location = 'hand';
    newState.players[action.playerId].hand.push(runeId);
    newState.players[action.playerId].charges += 1;
    return {
        success: true,
        action,
        newState,
        sideEffects: [{ type: 'DrawRune', playerId: action.playerId, runeInstanceId: runeId }]
    };
}
function handleUseRune(state, action) {
    const player = state.players[action.playerId];
    if (player.hand.length === 0)
        return { success: false, error: 'No runes in hand.', action };
    const runeId = player.hand[player.hand.length - 1];
    const newState = deepClone(state);
    newState.allCards[runeId].location = 'runeDiscard';
    newState.players[action.playerId].hand.pop();
    newState.players[action.playerId].runeDiscard.push(runeId);
    newState.players[action.playerId].mana += 1;
    return { success: true, action, newState };
}
function handleHideCard(state, action) {
    const { cardInstanceId } = action.payload;
    const card = state.allCards[cardInstanceId];
    if (!card)
        return { success: false, error: 'Card not found.', action };
    if (card.location !== 'hand')
        return { success: false, error: 'Card not in hand.', action };
    const def = state.cardDefinitions[card.cardId];
    if (!def.keywords.includes('Hidden'))
        return { success: false, error: 'Card does not have Hidden.', action };
    const player = state.players[action.playerId];
    const cost = def.cost?.charges ?? 1;
    if (player.charges < cost)
        return { success: false, error: 'Not enough charges.', action };
    const newState = deepClone(state);
    newState.players[action.playerId].charges -= cost;
    newState.players[action.playerId].hiddenZone.push(cardInstanceId);
    newState.allCards[cardInstanceId].location = 'hidden';
    newState.allCards[cardInstanceId].facing = 'down';
    newState.allCards[cardInstanceId].owner_hidden = true;
    return { success: true, action, newState };
}
function handleReactFromHidden(state, action) {
    const { cardInstanceId } = action.payload;
    const card = state.allCards[cardInstanceId];
    if (!card || card.location !== 'hidden')
        return { success: false, error: 'Card not in hidden zone.', action };
    const newState = deepClone(state);
    newState.allCards[cardInstanceId].facing = 'up';
    newState.allCards[cardInstanceId].owner_hidden = false;
    return { success: true, action, newState };
}
function handleUseAbility(state, action) {
    const { cardInstanceId, abilityIndex, targetId, targetBattlefieldId } = action.payload;
    const newState = deepClone(state);
    const effects = resolveAbilities(newState, cardInstanceId, 'ABILITY', abilityIndex, targetId, targetBattlefieldId);
    return { success: true, action, newState, sideEffects: effects };
}
function handleConcede(state, action) {
    const opponentId = getOpponentId(state, action.playerId);
    const newState = deepClone(state);
    return {
        success: true,
        newState: { ...newState, phase: 'GameOver', winner: opponentId },
        action,
        sideEffects: [{ type: 'GameWin', playerId: opponentId, reason: 'concede' }]
    };
}
function handleMulligan(state, action) {
    const { keepIds } = action.payload;
    const player = state.players[action.playerId];
    const newState = deepClone(state);
    const allPlayerIds = Object.keys(newState.players);
    // Rule 118: a player may set aside up to 2 cards during mulligan
    const toReturn = player.hand.filter(id => !keepIds.includes(id));
    if (toReturn.length > 2) {
        return { success: false, error: 'Mulligan: may set aside at most 2 cards.', action };
    }
    const newHand = keepIds.filter(id => player.hand.includes(id));
    for (const id of toReturn) {
        newState.allCards[id].location = 'deck';
        newState.players[action.playerId].deck.push(id);
    }
    newState.players[action.playerId].hand = newHand;
    // Shuffle returned cards back in
    (0, utils_1.shuffle)(newState.players[action.playerId].deck);
    // Draw back up to hand size of 4 (Rule 118.1-118.3)
    while (newState.players[action.playerId].hand.length < 4) {
        const cardId = newState.players[action.playerId].deck.shift();
        if (cardId) {
            newState.allCards[cardId].location = 'hand';
            newState.players[action.playerId].hand.push(cardId);
        }
        else
            break;
    }
    // Track turn order: the player who was chosen first (activePlayerId at start
    // of Mulligan phase) hasGoneFirst=true; the second player hasGoneFirst=false.
    // The first player (hasGoneFirst=true) will take the first turn of the game.
    const opponentId = allPlayerIds.find(id => id !== action.playerId);
    if (opponentId) {
        // The player who is NOT acting right now is the first player (they act first in turn order)
        newState.players[action.playerId].hasGoneFirst = false; // second to act in turn order
        newState.players[opponentId].hasGoneFirst = true; // first to act in turn order
    }
    // Check if both players have completed mulligan BEFORE marking current player ready
    const bothReady = allPlayerIds
        .filter(id => id !== action.playerId) // exclude current player
        .every(id => newState.players[id].isReady);
    // Mark current player ready
    newState.players[action.playerId].isReady = true;
    if (bothReady) {
        // Both players have now completed mulligan — transition to first turn
        newState.players[action.playerId].mulligansComplete = true;
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
        newState: { ...newState, activePlayerId: opponentId },
    };
}
// ============================================================
// Ability Resolution
// ============================================================
function resolveAbilities(state, cardInstanceId, trigger, abilityIndex, targetId, targetBattlefieldId) {
    const card = state.allCards[cardInstanceId];
    if (!card)
        return [];
    const def = state.cardDefinitions[card.cardId];
    const effects = [];
    const abilitiesToResolve = abilityIndex !== undefined
        ? [def.abilities[abilityIndex]].filter(Boolean)
        : def.abilities.filter(a => a.trigger === trigger);
    for (const ability of abilitiesToResolve) {
        if (!ability.effectCode)
            continue;
        const code = ability.effectCode;
        if (code === 'ENTER:GIVE_MIGHT_3') {
            if (targetId) {
                effects.push({ type: 'ApplyModifier', unitInstanceId: targetId, modifier: 'might', value: 3 });
                const unit = state.allCards[targetId];
                if (unit)
                    unit.currentStats.might = (unit.currentStats.might ?? 0) + 3;
            }
        }
        if (code === 'PLAY:DEAL_2_ENEMY') {
            // Find enemy unit at same battlefield
            const bf = state.battlefields.find(b => b.id === card.battlefieldId);
            if (bf) {
                const enemy = bf.units.find(id => state.allCards[id].ownerId !== card.ownerId);
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
                };
                const bf = state.battlefields.find(b => b.id === card.battlefieldId);
                if (bf)
                    bf.units.push(goldId);
                effects.push({ type: 'TriggerAbility', cardInstanceId: goldId, trigger: 'token_spawn' });
            }
        }
        if (trigger === 'MOVE' || code === 'MOVE:ADD_CHARGE_1') {
            const p = state.players[card.ownerId];
            if (p)
                p.charges += 1;
            effects.push({ type: 'ReadyPlayer', playerId: card.ownerId });
        }
        if (code.startsWith('READY_UNIT') || trigger === 'READY') {
            if (targetId) {
                effects.push({ type: 'ReadyUnit', unitInstanceId: targetId });
                const unit = state.allCards[targetId];
                if (unit)
                    unit.ready = true;
            }
        }
    }
    return effects;
}
function resolveSpellEffect(state, cardInstanceId, targetId, targetBattlefieldId) {
    const card = state.allCards[cardInstanceId];
    if (!card)
        return [];
    const def = state.cardDefinitions[card.cardId];
    const effects = [];
    for (const ability of def.abilities) {
        const code = ability.effectCode ?? ability.trigger;
        const targetCard = targetId ? state.allCards[targetId] : null;
        if (code.includes('DEAL_3') || code.includes('DEAL_3_BANISH_ON_DEATH')) {
            if (targetCard) {
                const hp = targetCard.currentStats.health ?? targetCard.stats.health ?? 1;
                targetCard.currentStats.health = hp - 3;
                effects.push({ type: 'DamageUnit', unitInstanceId: targetId, damage: 3 });
                if (targetCard.currentStats.health <= 0) {
                    effects.push({ type: 'KillUnit', unitInstanceId: targetId });
                    targetCard.location = 'discard';
                    const p = state.players[targetCard.ownerId];
                    if (p)
                        p.discardPile.push(targetId);
                    const bf = state.battlefields.find(b => b.id === targetCard.battlefieldId);
                    if (bf)
                        bf.units = bf.units.filter(id => id !== targetId);
                }
            }
        }
        if (code.includes('DEAL_2_OR_4_FACEDOWN')) {
            // Check if player controls a facedown card
            const hasFacedown = Object.values(state.players).some(p => p.hiddenZone.length > 0);
            const damage = hasFacedown ? 4 : 2;
            if (targetCard) {
                targetCard.currentStats.health = (targetCard.currentStats.health ?? 1) - damage;
                effects.push({ type: 'DamageUnit', unitInstanceId: targetId, damage });
            }
        }
        if (code.includes('READY_UNIT') || code.includes('GIVE_ASSAULT')) {
            // Square Up / Vault Breaker
            if (targetCard && targetCard.location === 'battlefield') {
                effects.push({ type: 'ReadyUnit', unitInstanceId: targetId });
                targetCard.ready = true;
            }
        }
        if (code.includes('GIVE_ASSAULT')) {
            if (targetCard) {
                effects.push({ type: 'ApplyModifier', unitInstanceId: targetId, modifier: 'assault', value: 2 });
            }
        }
    }
    return effects;
}
// ============================================================
// Helpers
// ============================================================
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function getOpponentId(state, playerId) {
    return Object.keys(state.players).find(pid => pid !== playerId) ?? playerId;
}
function getUnitOwner(state, unitInstanceId) {
    return state.allCards[unitInstanceId]?.ownerId ?? '';
}
function makeLog(state, playerId, logType, message) {
    return {
        id: (0, utils_1.randomId)(),
        type: logType,
        playerId,
        message,
        turn: state.turn,
        phase: state.phase,
        timestamp: Date.now(),
    };
}
// ============================================================
// AI Move Generation
// ============================================================
function getLegalActions(state, playerId) {
    const actions = [];
    if (state.phase === 'GameOver')
        return actions;
    const player = state.players[playerId];
    if (!player)
        return actions;
    // Mulligan is legal during Mulligan phase for the active player who hasn't completed it yet
    if (state.phase === 'Mulligan' && state.activePlayerId === playerId && !player.mulligansComplete) {
        actions.push(makeAction('Mulligan', playerId, { keepIds: [...player.hand] }));
    }
    // Pass is legal in Action sub-phases (FirstMain, Combat, SecondMain) and when in Action parent
    if (['FirstMain', 'Combat', 'SecondMain'].includes(state.phase) || state.phase === 'Action') {
        actions.push(makeAction('Pass', playerId, {}));
    }
    // Play units from hand
    for (const cardId of player.hand) {
        const card = state.allCards[cardId];
        if (!card)
            continue;
        const def = state.cardDefinitions[card.cardId];
        if (def.type === 'Unit' && player.mana >= (def.cost?.rune ?? 0)) {
            for (const bf of state.battlefields) {
                // In MVP, can play to any BF where you have units (or it's unoccupied)
                if (bf.controllerId === playerId || bf.units.some(id => state.allCards[id]?.ownerId === playerId)) {
                    actions.push(makeAction('PlayUnit', playerId, { cardInstanceId: cardId, battlefieldId: bf.id, hidden: false, accelerate: false }));
                    if (def.keywords.includes('Accelerate')) {
                        actions.push(makeAction('PlayUnit', playerId, { cardInstanceId: cardId, battlefieldId: bf.id, hidden: false, accelerate: true }));
                    }
                }
            }
        }
        if (def.type === 'Spell' && player.mana >= (def.cost?.rune ?? 0)) {
            actions.push(makeAction('PlaySpell', playerId, { cardInstanceId: cardId }));
        }
        if (def.type === 'Gear' && player.mana >= (def.cost?.rune ?? 0)) {
            for (const bf of state.battlefields) {
                const myUnits = bf.units.filter(id => state.allCards[id]?.ownerId === playerId);
                for (const unitId of myUnits) {
                    actions.push(makeAction('PlayGear', playerId, { cardInstanceId: cardId, targetUnitId: unitId }));
                }
            }
        }
    }
    // Move units (Ganking)
    for (const bf of state.battlefields) {
        for (const unitId of bf.units) {
            const unit = state.allCards[unitId];
            if (!unit || unit.ownerId !== playerId || !unit.ready)
                continue;
            const def = state.cardDefinitions[unit.cardId];
            if (!def.keywords.includes('Ganking'))
                continue;
            for (const targetBf of state.battlefields) {
                if (targetBf.id === bf.id)
                    continue;
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
        for (const unitId of bf.units) {
            const unit = state.allCards[unitId];
            if (!unit || unit.ownerId !== playerId || !unit.ready)
                continue;
            // Can attack any BF (including your own if you want to score)
            if (bf.id !== unit.battlefieldId) { // Can't attack from same BF
                actions.push(makeAction('Attack', playerId, { attackerId: unitId, targetBattlefieldId: bf.id }));
            }
        }
    }
    // Use runes
    if (player.hand.some(id => state.allCards[id]?.cardId === 'Rune') && player.runeDeck.length > 0) {
        actions.push(makeAction('UseRune', playerId, {}));
    }
    return actions;
}
function makeAction(type, playerId, payload) {
    return {
        id: (0, utils_1.randomId)(),
        type,
        playerId,
        payload,
        turn: 0,
        phase: 'FirstMain',
        timestamp: Date.now(),
    };
}

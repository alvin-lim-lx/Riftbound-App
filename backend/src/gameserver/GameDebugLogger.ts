import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { CardInstance, GameAction, GameLogEntry, GameState } from '../../shared/src/types';
import type { GameSideEffect } from '../engine/GameEngine';

export interface GameDebugRecord {
  event: string;
  gameId: string;
  timestamp?: number;
  actorPlayerId?: string;
  action?: GameAction;
  result?: {
    success: boolean;
    error?: string;
    sideEffects?: GameSideEffect[];
  };
  publicLogEntries?: GameLogEntry[];
  stateBefore?: GameState;
  stateAfter?: GameState;
  detail?: Record<string, unknown>;
}

export class GameDebugLogger {
  private seqByGame = new Map<string, number>();
  private readonly logDir: string;

  constructor(logDir = path.resolve(process.cwd(), '..', '.dev_logs', 'games')) {
    this.logDir = logDir;
  }

  log(record: GameDebugRecord): void {
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      const seq = (this.seqByGame.get(record.gameId) ?? 0) + 1;
      this.seqByGame.set(record.gameId, seq);
      const payload = {
        seq,
        timestamp: record.timestamp ?? Date.now(),
        event: record.event,
        gameId: record.gameId,
        actorPlayerId: record.actorPlayerId,
        action: record.action,
        result: record.result,
        publicLogEntries: record.publicLogEntries,
        detail: record.detail,
        stateBeforeSummary: record.stateBefore ? this.summarizeState(record.stateBefore) : undefined,
        stateAfterSummary: record.stateAfter ? this.summarizeState(record.stateAfter) : undefined,
        initialState: record.event === 'game_created' && record.stateAfter ? this.initialSnapshot(record.stateAfter) : undefined,
        changedState: record.stateBefore && record.stateAfter ? this.diffStates(record.stateBefore, record.stateAfter) : undefined,
      };
      const safeGameId = record.gameId.replace(/[^a-zA-Z0-9_.-]/g, '_');
      fs.appendFileSync(path.join(this.logDir, `${safeGameId}.jsonl`), `${JSON.stringify(payload)}\n`, 'utf8');
    } catch (err) {
      console.error('[GameDebugLogger] Failed to write debug record:', err);
    }
  }

  private summarizeState(state: GameState) {
    return {
      id: state.id,
      turn: state.turn,
      phase: state.phase,
      activePlayerId: state.activePlayerId,
      winner: state.winner,
      actionLogLength: state.actionLog.length,
      showdown: state.showdown
        ? {
            kind: state.showdown.kind,
            battlefieldId: state.showdown.battlefieldId,
            focusPlayerId: state.showdown.focusPlayerId,
            combatStep: state.showdown.combatStep,
            stackSize: state.showdown.actionStack.length,
          }
        : null,
      pendingCombatDamageAssignment: state.pendingCombatDamageAssignment
        ? {
            assigningPlayerId: state.pendingCombatDamageAssignment.assigningPlayerId,
            sourceSide: state.pendingCombatDamageAssignment.sourceSide,
            availableDamage: state.pendingCombatDamageAssignment.availableDamage,
          }
        : null,
      players: Object.fromEntries(Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        {
          name: player.name,
          score: player.score,
          xp: player.xp,
          energy: player.energy,
          maxEnergy: player.maxEnergy,
          charges: player.charges,
          floatingEnergy: player.floatingEnergy,
          handCount: player.hand.length,
          deckCount: player.deck.length,
          runeDeckCount: player.runeDeck.length,
          runeDiscardCount: player.runeDiscard.length,
          discardCount: player.discardPile.length,
          hiddenZoneCount: player.hiddenZone.length,
          baseZoneCount: player.baseZone.length,
          equipmentCount: Object.keys(player.equipment).length,
          isReady: player.isReady,
          mulligansComplete: player.mulligansComplete,
        },
      ])),
      battlefields: state.battlefields.map(battlefield => ({
        id: battlefield.id,
        name: battlefield.name,
        controllerId: battlefield.controllerId,
        unitCount: battlefield.units.length,
        scoringSince: battlefield.scoringSince,
        scoringPlayerId: battlefield.scoringPlayerId,
      })),
    };
  }

  private initialSnapshot(state: GameState) {
    return {
      id: state.id,
      createdAt: state.createdAt,
      isPvP: state.isPvP,
      scoreLimit: state.scoreLimit,
      players: Object.fromEntries(Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        {
          name: player.name,
          hand: player.hand,
          deck: player.deck,
          runeDeck: player.runeDeck,
          runeDiscard: player.runeDiscard,
          discardPile: player.discardPile,
          hiddenZone: player.hiddenZone,
          baseZone: player.baseZone,
          legend: player.legend,
          chosenChampion: player.chosenChampion,
          equipment: player.equipment,
          hasGoneFirst: player.hasGoneFirst,
        },
      ])),
      battlefields: state.battlefields,
      cards: Object.fromEntries(Object.entries(state.allCards).map(([id, card]) => [id, this.compactCard(card)])),
      cardDefinitionsRef: this.cardDefinitionsRef(state),
      publicLogEntries: state.actionLog,
    };
  }

  private diffStates(before: GameState, after: GameState) {
    return {
      cards: this.diffCards(before, after),
      zones: this.diffZones(before, after),
      battlefields: this.diffBattlefields(before, after),
      scoredBattlefieldsThisTurn: this.changedValue(before.scoredBattlefieldsThisTurn, after.scoredBattlefieldsThisTurn),
      effectStack: this.changedValue(before.effectStack, after.effectStack),
      showdown: this.changedValue(before.showdown, after.showdown),
      pendingCombatDamageAssignment: this.changedValue(before.pendingCombatDamageAssignment, after.pendingCombatDamageAssignment),
      winner: before.winner !== after.winner ? { before: before.winner, after: after.winner } : undefined,
    };
  }

  private diffCards(before: GameState, after: GameState) {
    const ids = new Set([...Object.keys(before.allCards), ...Object.keys(after.allCards)]);
    const changed: Record<string, { before?: ReturnType<GameDebugLogger['compactCard']>; after?: ReturnType<GameDebugLogger['compactCard']> }> = {};

    for (const id of ids) {
      const beforeCard = before.allCards[id];
      const afterCard = after.allCards[id];
      const beforeCompact = beforeCard ? this.compactCard(beforeCard) : undefined;
      const afterCompact = afterCard ? this.compactCard(afterCard) : undefined;
      if (JSON.stringify(beforeCompact) !== JSON.stringify(afterCompact)) {
        changed[id] = { before: beforeCompact, after: afterCompact };
      }
    }

    return Object.keys(changed).length > 0 ? changed : undefined;
  }

  private diffZones(before: GameState, after: GameState) {
    const changed: Record<string, Record<string, { before: unknown; after: unknown }>> = {};
    const fields = ['hand', 'deck', 'runeDeck', 'runeDiscard', 'discardPile', 'hiddenZone', 'baseZone', 'equipment'] as const;

    for (const playerId of new Set([...Object.keys(before.players), ...Object.keys(after.players)])) {
      const beforePlayer = before.players[playerId];
      const afterPlayer = after.players[playerId];
      if (!beforePlayer || !afterPlayer) continue;

      for (const field of fields) {
        const beforeValue = beforePlayer[field];
        const afterValue = afterPlayer[field];
        if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
          changed[playerId] = changed[playerId] ?? {};
          changed[playerId][field] = { before: beforeValue, after: afterValue };
        }
      }
    }

    return Object.keys(changed).length > 0 ? changed : undefined;
  }

  private diffBattlefields(before: GameState, after: GameState) {
    const changed: Record<string, { before?: unknown; after?: unknown }> = {};
    const beforeById = Object.fromEntries(before.battlefields.map(battlefield => [battlefield.id, battlefield]));
    const afterById = Object.fromEntries(after.battlefields.map(battlefield => [battlefield.id, battlefield]));

    for (const id of new Set([...Object.keys(beforeById), ...Object.keys(afterById)])) {
      const beforeBattlefield = beforeById[id];
      const afterBattlefield = afterById[id];
      if (JSON.stringify(beforeBattlefield) !== JSON.stringify(afterBattlefield)) {
        changed[id] = { before: beforeBattlefield, after: afterBattlefield };
      }
    }

    return Object.keys(changed).length > 0 ? changed : undefined;
  }

  private changedValue<T>(before: T, after: T) {
    return JSON.stringify(before) === JSON.stringify(after) ? undefined : { before, after };
  }

  private compactCard(card: CardInstance) {
    return {
      instanceId: card.instanceId,
      cardId: card.cardId,
      ownerId: card.ownerId,
      location: card.location,
      battlefieldId: card.battlefieldId,
      ready: card.ready,
      exhausted: card.exhausted,
      stats: card.stats,
      currentStats: card.currentStats,
      damage: card.damage,
      counters: card.counters,
      attachments: card.attachments,
      facing: card.facing,
      owner_hidden: card.owner_hidden,
    };
  }

  private cardDefinitionsRef(state: GameState) {
    const ids = Object.keys(state.cardDefinitions).sort();
    return {
      count: ids.length,
      hash: createHash('sha256').update(JSON.stringify(ids.map(id => state.cardDefinitions[id]))).digest('hex'),
    };
  }
}

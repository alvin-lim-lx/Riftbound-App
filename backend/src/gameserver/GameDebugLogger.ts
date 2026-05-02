import fs from 'fs';
import path from 'path';
import type { GameAction, GameLogEntry, GameState } from '../../shared/src/types';
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
        ...record,
        stateBeforeSummary: record.stateBefore ? this.summarizeState(record.stateBefore) : undefined,
        stateAfterSummary: record.stateAfter ? this.summarizeState(record.stateAfter) : undefined,
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
          energy: player.energy,
          charges: player.charges,
          hand: player.hand,
          deckCount: player.deck.length,
          runeDeckCount: player.runeDeck.length,
          hiddenZone: player.hiddenZone,
          discardPile: player.discardPile,
        },
      ])),
    };
  }
}

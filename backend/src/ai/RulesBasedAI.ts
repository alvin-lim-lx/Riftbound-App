/**
 * Rules-Based AI for Riftbound
 * ============================
 * Generates all legal moves, evaluates them, and picks the best one.
 * Designed to be replaced later with MCTS or neural evaluation.
 */

import type { GameState, GameAction } from '../../../shared/src/types';
import { getLegalActions } from '../engine/GameEngine';

interface ScoredAction {
  action: GameAction;
  score: number;
  reason: string;
}

export class RulesBasedAI {
  private playerId: string;

  constructor(playerId: string) {
    this.playerId = playerId;
  }

  decide(state: GameState): GameAction {
    const legalActions = getLegalActions(state, this.playerId);

    if (legalActions.length === 0) {
      // Fallback: pass
      return {
        id: `ai_${Date.now()}`,
        type: 'Pass',
        playerId: this.playerId,
        payload: {},
        turn: state.turn,
        phase: state.phase,
        timestamp: Date.now(),
      };
    }

    const scored = legalActions.map(action => this.scoreAction(action, state));
    scored.sort((a, b) => b.score - a.score);

    // Debug log top 3
    if (scored.length > 0) {
      console.log(`[AI ${this.playerId}] Top actions:`);
      scored.slice(0, 3).forEach(s => {
        console.log(`  ${s.action.type}: score=${s.score} (${s.reason})`);
      });
    }

    return scored[0].action;
  }

  private scoreAction(action: GameAction, state: GameState): ScoredAction {
    const opponentId = Object.keys(state.players).find(id => id !== this.playerId)!;
    const me = state.players[this.playerId];
    const opponent = state.players[opponentId];

    switch (action.type) {
      case 'Pass':
        return { action, score: 0, reason: 'Pass turn' };

      case 'Attack': {
        const { attackerId, targetBattlefieldId } = action.payload as any;
        const targetBf = state.battlefields.find(b => b.id === targetBattlefieldId);
        const attacker = state.allCards[attackerId];
        const def = state.cardDefinitions[attacker.cardId];
        const might = attacker.currentStats.might ?? attacker.stats.might ?? 0;
        let score = 30 + might * 5;

        // Prefer attacking contested BFs
        if (targetBf?.controllerId && targetBf.controllerId !== this.playerId) {
          score += 20; // Contested
        }

        // Prefer attacking unconquered BFs (can be first to score)
        if (!targetBf?.controllerId) {
          score += 15;
        }

        // Check if we can win by conquering
        if (me.score + 1 >= state.scoreLimit) {
          score += 1000; // Win imminent
        }

        // Check for likely survival
        const enemyUnits = targetBf?.units.filter(id =>
          state.allCards[id]?.ownerId !== this.playerId
        ) ?? [];
        let enemyMight = 0;
        for (const euId of enemyUnits) {
          const eu = state.allCards[euId];
          enemyMight += eu?.currentStats.might ?? eu?.stats.might ?? 0;
        }
        if (enemyMight >= might) {
          score -= 30; // Likely to die
        }

        return { action, score, reason: `Attack ${def?.name} might=${might} vs enemy might=${enemyMight}` };
      }

      case 'PlayUnit': {
        const { cardInstanceId } = action.payload as any;
        const card = state.allCards[cardInstanceId];
        const def = state.cardDefinitions[card.cardId];
        const manaCost = def.cost?.rune ?? 0;
        const might = def.stats?.might ?? 0;
        const health = def.stats?.health ?? 0;
        let score = 10 + might * 3 + health * 2;

        // Cost efficiency
        const efficiency = (might + health) / Math.max(manaCost, 1);
        score += efficiency * 5;

        // Keywords are valuable
        if (def.keywords.includes('Ganking')) score += 10;
        if (def.keywords.includes('Ambush')) score += 8;
        if (def.keywords.includes('Assault')) score += 8;
        if (def.keywords.includes('Deflect')) score += 6;
        if (def.keywords.includes('Hunt')) score += 12;
        if (def.keywords.includes('Accelerate')) score += 5;

        // Mana efficiency
        if (manaCost <= me.mana) score += 5;

        return { action, score, reason: `Play ${def.name} cost=${manaCost} might=${might}` };
      }

      case 'PlaySpell': {
        const { cardInstanceId } = action.payload as any;
        const card = state.allCards[cardInstanceId];
        const def = state.cardDefinitions[card.cardId];
        const cost = def.cost?.rune ?? 0;
        let score = 5 + cost * 2;

        // Prefer removal spells
        if (def.abilities.some(a => a.effectCode?.includes('DEAL'))) {
          score += 15;
        }

        return { action, score, reason: `Play spell ${def.name} cost=${cost}` };
      }

      case 'PlayGear': {
        const { cardInstanceId } = action.payload as any;
        const card = state.allCards[cardInstanceId];
        const def = state.cardDefinitions[card.cardId];
        const bonus = def.stats?.might ?? 0;
        let score = 8 + bonus * 4;
        return { action, score, reason: `Equip ${def.name} +${bonus} might` };
      }

      case 'MoveUnit': {
        const { cardInstanceId, toBattlefieldId } = action.payload as any;
        const unit = state.allCards[cardInstanceId];
        const def = state.cardDefinitions[unit.cardId];
        const targetBf = state.battlefields.find(b => b.id === toBattlefieldId);
        let score = 5;

        // Moving to unconquered BF is strategic
        if (!targetBf?.controllerId) score += 15;

        // Moving to BF we already control (for scoring) is good
        if (targetBf?.controllerId === this.playerId) {
          score += 10 + me.score * 2; // More valuable if close to winning
        }

        // Jhin bonus for moving
        if (def.name.includes('Jhin')) score += 10;

        return { action, score, reason: `Move ${def.name} to ${targetBf?.name}` };
      }

      case 'Mulligan': {
        // Keep all cards — no penalty, no bonus
        const score = 5;
        return { action, score, reason: 'Mulligan — keep all' };
      }

      default:
        return { action, score: 1, reason: 'Default' };
    }
  }

}

export function createAI(playerId: string): RulesBasedAI {
  return new RulesBasedAI(playerId);
}

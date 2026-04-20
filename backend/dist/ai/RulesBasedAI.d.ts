/**
 * Rules-Based AI for Riftbound
 * ============================
 * Generates all legal moves, evaluates them, and picks the best one.
 * Designed to be replaced later with MCTS or neural evaluation.
 */
import type { GameState, GameAction } from '../../../shared/src/types';
export declare class RulesBasedAI {
    private playerId;
    constructor(playerId: string);
    decide(state: GameState): GameAction;
    private scoreAction;
}
export declare function createAI(playerId: string): RulesBasedAI;
//# sourceMappingURL=RulesBasedAI.d.ts.map
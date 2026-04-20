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
import { GameState, Phase, GameAction } from '../../shared/src/types';
export interface ActionResult {
    success: boolean;
    error?: string;
    action?: GameAction;
    newState?: GameState;
    sideEffects?: GameSideEffect[];
}
export type GameSideEffect = {
    type: 'DrawRune';
    playerId: string;
    runeInstanceId: string;
} | {
    type: 'DamageUnit';
    unitInstanceId: string;
    damage: number;
} | {
    type: 'KillUnit';
    unitInstanceId: string;
} | {
    type: 'ReadyUnit';
    unitInstanceId: string;
} | {
    type: 'ExhaustUnit';
    unitInstanceId: string;
} | {
    type: 'MoveUnit';
    unitInstanceId: string;
    from: string;
    to: string;
} | {
    type: 'ScoreBattlefield';
    battlefieldId: string;
    playerId: string;
} | {
    type: 'ConquerBattlefield';
    battlefieldId: string;
    playerId: string;
} | {
    type: 'AttachGear';
    gearInstanceId: string;
    unitInstanceId: string;
} | {
    type: 'TriggerAbility';
    cardInstanceId: string;
    trigger: string;
} | {
    type: 'ApplyModifier';
    unitInstanceId: string;
    modifier: string;
    value: number;
} | {
    type: 'ReadyPlayer';
    playerId: string;
} | {
    type: 'GameWin';
    playerId: string;
    reason: string;
};
export interface PlayerDeckConfig {
    legendId: string;
    cardIds: string[];
    runeIds?: string[];
    battlefieldIds?: string[];
    sideboardIds?: string[];
}
export declare function createGame(playerIds: string[], playerNames: string[], options?: {
    scoreLimit?: number;
    isPvP?: boolean;
    playerDecks?: Record<string, PlayerDeckConfig>;
}): GameState;
export declare function executeAction(state: GameState, action: GameAction): ActionResult;
export declare function advancePhase(state: GameState): GameState;
export declare function startNewTurn(state: GameState): GameState;
export declare function enterPhase(state: GameState, phase: Phase): GameState;
export declare function checkScoring(state: GameState): GameState;
export declare function checkWinCondition(state: GameState): string | null;
export declare function resolveShowdown(state: GameState, attackerId: string, targetBattlefieldId: string): ActionResult;
export declare function deepClone<T>(obj: T): T;
export declare function getLegalActions(state: GameState, playerId: string): GameAction[];
//# sourceMappingURL=GameEngine.d.ts.map
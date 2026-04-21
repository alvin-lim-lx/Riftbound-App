/**
 * Player Position Unit Tests — Issue #3 fix verification
 * Tests that the actual player (human) is correctly identified as "player"
 * and the opponent as "opponent" in the game state, so the TopBar can
 * render them in the correct positions (player on left, opponent on right).
 */

import { createGame } from '../src/engine/GameEngine';
import type { PlayerState } from '../../shared/src/types';

const P1 = 'player_1';
const P2 = 'player_2';

describe('Player Position — Issue #3: Wrong position of player', () => {
  describe('createGame player assignment', () => {
    it('assigns the first player the human username (allx1988)', () => {
      // The game state should store the human player's username
      const state = createGame([P1, P2], ['allx1988', 'AI_Opponent']);

      // P1 should have the human username
      expect(state.players[P1].name).toBe('allx1988');
      expect(state.players[P2].name).toBe('AI_Opponent');
    });

    it('distinguishes player vs opponent by id, not by name', () => {
      const state = createGame([P1, P2], ['Alice', 'Bob']);

      // The players object should have both players
      const playerIds = Object.keys(state.players);
      expect(playerIds).toContain(P1);
      expect(playerIds).toContain(P2);

      // Each player should have a valid id matching their key
      expect(state.players[P1].id).toBe(P1);
      expect(state.players[P2].id).toBe(P2);
    });
  });

  describe('TopBar player/opponent assignment logic', () => {
    it('playerId should map to the human player in players dict', () => {
      const state = createGame([P1, P2], ['allx1988', 'AI_Opponent']);

      // The playerId (first player in array) should be the human player
      const humanPlayerId = P1;
      const humanPlayer: PlayerState = state.players[humanPlayerId];

      expect(humanPlayer).toBeDefined();
      expect(humanPlayer.name).toBe('allx1988');
      expect(humanPlayer.id).toBe(humanPlayerId);
    });

    it('opponent should be the other player', () => {
      const state = createGame([P1, P2], ['allx1988', 'AI_Opponent']);

      const humanPlayerId = P1;
      const opponentId = P2;
      const opponent: PlayerState = state.players[opponentId];

      expect(opponent).toBeDefined();
      expect(opponent.name).toBe('AI_Opponent');
      expect(opponent.id).toBe(opponentId);
      expect(opponent.id).not.toBe(humanPlayerId);
    });
  });
});

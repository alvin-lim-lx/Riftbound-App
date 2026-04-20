/**
 * GamePage — Entry point for the game view.
 * Uses the new BoardLayout.
 */

import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { gameService } from '../../services/gameService';
import { BoardLayout } from './BoardLayout';

export function GamePage() {
  const store = useGameStore();
  const storeRef = React.useRef(store);
  storeRef.current = store;

  useEffect(() => {
    const onGameStart = (data: any) => {
      console.log('[GamePage] Game started:', data);
      storeRef.current.setGameState(data.initialState);
      storeRef.current.setLobby(null);
      storeRef.current.addLog('Game started!');
    };

    const onStateUpdate = (data: any) => {
      storeRef.current.setGameState(data.state);
    };

    const onGameOver = (data: any) => {
      storeRef.current.addLog(`Game Over! Winner: ${data.winnerId}`);
    };

    const onError = (data: any) => {
      storeRef.current.addLog(`Error: ${data.message}`);
    };

    gameService.on('game_start', onGameStart);
    gameService.on('game_state_update', onStateUpdate);
    gameService.on('game_over', onGameOver);
    gameService.on('error', onError);

    return () => {
      gameService.off('game_start', onGameStart);
      gameService.off('game_state_update', onStateUpdate);
      gameService.off('game_over', onGameOver);
      gameService.off('error', onError);
    };
  }, []);

  return <BoardLayout />;
}
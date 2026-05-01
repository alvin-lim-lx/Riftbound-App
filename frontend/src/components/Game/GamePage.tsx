/**
 * GamePage — Entry point for the game view.
 * Uses the new BoardLayout.
 */

import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { gameService } from '../../services/gameService';
import { BoardLayout } from './BoardLayout';

interface GamePageProps {
  onExitToLobby?: () => void;
}

export function GamePage({ onExitToLobby }: GamePageProps) {
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

    const onChatMessage = (data: any) => {
      const sender = data.playerId === storeRef.current.playerId ? 'player' : 'opponent';
      storeRef.current.addChatMessage({ sender, text: data.text });
    };

    gameService.on('game_start', onGameStart);
    gameService.on('game_state_update', onStateUpdate);
    gameService.on('game_over', onGameOver);
    gameService.on('error', onError);
    gameService.on('chat_message', onChatMessage);

    return () => {
      gameService.off('game_start', onGameStart);
      gameService.off('game_state_update', onStateUpdate);
      gameService.off('game_over', onGameOver);
      gameService.off('error', onError);
      gameService.off('chat_message', onChatMessage);
    };
  }, []);

  return <BoardLayout onExitToLobby={onExitToLobby} />;
}

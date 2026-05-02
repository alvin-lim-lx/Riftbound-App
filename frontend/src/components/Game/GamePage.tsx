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
      storeRef.current.hydrateGameLog(data.initialLog ?? []);
      storeRef.current.setLobby(null);
    };

    const onStateUpdate = (data: any) => {
      storeRef.current.setGameState(data.state);
    };

    const onGameOver = (data: any) => {
      if (storeRef.current.gameLogEntries.some(entry => entry.type === 'GameOver')) return;
      const winnerName = storeRef.current.gameState?.players[data.winnerId]?.name ?? data.winnerId;
      storeRef.current.addGameLogEntries([{
        id: `game-over-${data.winnerId}-${Date.now()}`,
        type: 'GameOver',
        message: `Game over: ${winnerName} wins`,
        turn: storeRef.current.gameState?.turn ?? 0,
        phase: storeRef.current.gameState?.phase ?? 'GameOver',
        timestamp: Date.now(),
      }]);
    };

    const onError = (data: any) => {
      storeRef.current.addWarning(data.message ?? 'Something went wrong.');
    };

    const onActionResult = (data: any) => {
      if (data.success === false) {
        storeRef.current.addWarning(data.error ?? 'Action failed.');
      }
    };

    const onGameLog = (data: any) => {
      storeRef.current.addGameLogEntries(data.entries ?? []);
    };

    const onChatMessage = (data: any) => {
      const sender = data.playerId === storeRef.current.playerId ? 'player' : 'opponent';
      storeRef.current.addChatMessage({ sender, text: data.text });
    };

    gameService.on('game_start', onGameStart);
    gameService.on('game_state_update', onStateUpdate);
    gameService.on('game_log', onGameLog);
    gameService.on('game_over', onGameOver);
    gameService.on('error', onError);
    gameService.on('action_result', onActionResult);
    gameService.on('chat_message', onChatMessage);

    return () => {
      gameService.off('game_start', onGameStart);
      gameService.off('game_state_update', onStateUpdate);
      gameService.off('game_log', onGameLog);
      gameService.off('game_over', onGameOver);
      gameService.off('error', onError);
      gameService.off('action_result', onActionResult);
      gameService.off('chat_message', onChatMessage);
    };
  }, []);

  return <BoardLayout onExitToLobby={onExitToLobby} />;
}

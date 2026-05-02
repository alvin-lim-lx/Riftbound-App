/**
 * Game Store - Zustand
 * Central state for the game UI
 */

import { create } from 'zustand';
import type {
  GameState, PlayerState, BattlefieldState, CardInstance,
  Phase, CardDefinition, PublicGameLogEntry
} from '../shared/types';
import { CARDS } from '../shared/cards';

interface ChatMessage {
  id: string;
  sender: 'player' | 'opponent' | 'system';
  text: string;
  timestamp: Date;
}

export interface PlayerWarning {
  id: string;
  message: string;
  timestamp: Date;
}

interface GameStore {
  playerId: string;
  opponentId: string | null;
  connected: boolean;
  selectedDeckId: string | null;

  gameId: string | null;
  gameState: GameState | null;
  myTurn: boolean;
  phase: Phase;

  selectedCardId: string | null;
  selectedTargetId: string | null;
  targetBattlefieldId: string | null;
  availableActions: string[];
  gameLogEntries: PublicGameLogEntry[];
  gameLog: string[];
  warnings: PlayerWarning[];
  chatMessages: ChatMessage[];
  showCardModal: boolean;
  modalCardId: string | null;

  lobbyId: string | null;
  inLobby: boolean;

  setPlayerId: (id: string) => void;
  setConnected: (connected: boolean) => void;
  setSelectedDeckId: (id: string | null) => void;
  setGameState: (state: GameState) => void;
  hydrateGameLog: (entries: PublicGameLogEntry[]) => void;
  addGameLogEntries: (entries: PublicGameLogEntry[]) => void;
  setLobby: (lobbyId: string | null) => void;
  selectCard: (cardId: string | null) => void;
  selectTarget: (targetId: string | null) => void;
  selectBattlefield: (bfId: string | null) => void;
  setModalCard: (cardId: string | null) => void;
  addLog: (message: string) => void;
  addWarning: (message: string) => void;
  dismissWarning: (id: string) => void;
  addChatMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  reset: () => void;

  myPlayer: () => PlayerState | null;
  opponentPlayer: () => PlayerState | null;
  myHand: () => CardInstance[];
  getCardDef: (cardId: string) => CardDefinition | undefined;
  getMyBattlefields: () => BattlefieldState[];
  getContestedBattlefields: () => BattlefieldState[];
}

const initialState = {
  playerId: '',
  opponentId: null,
  connected: false,
  selectedDeckId: null,
  gameId: null,
  gameState: null,
  myTurn: false,
  phase: 'Setup' as Phase,
  selectedCardId: null,
  selectedTargetId: null,
  targetBattlefieldId: null,
  availableActions: [],
  gameLogEntries: [],
  gameLog: [],
  warnings: [],
  chatMessages: [],
  showCardModal: false,
  modalCardId: null,
  lobbyId: null,
  inLobby: false,
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,

  setPlayerId: (id) => set({ playerId: id }),
  setConnected: (connected) => set({ connected }),
  setSelectedDeckId: (id) => set({ selectedDeckId: id }),

  setGameState: (gameState) => {
    const { playerId } = get();
    set({
      gameState,
      gameId: gameState.id,
      myTurn: gameState.activePlayerId === playerId,
      phase: gameState.phase,
    });
  },

  hydrateGameLog: (entries) => {
    const sorted = sortLogEntries(dedupeLogEntries(entries));
    set({
      gameLogEntries: sorted,
      gameLog: formatGameLogEntries(sorted),
    });
  },

  addGameLogEntries: (entries) => set((s) => {
    const merged = dedupeLogEntries([...s.gameLogEntries, ...entries]);
    const gameLogEntries = sortLogEntries(merged);
    return {
      gameLogEntries,
      gameLog: formatGameLogEntries(gameLogEntries),
    };
  }),

  setLobby: (lobbyId) => set({ lobbyId, inLobby: !!lobbyId }),

  selectCard: (cardId) => set({ selectedCardId: cardId, selectedTargetId: null }),
  selectTarget: (targetId) => set({ selectedTargetId: targetId }),
  selectBattlefield: (bfId) => set({ targetBattlefieldId: bfId }),
  setModalCard: (cardId) => set({ showCardModal: !!cardId, modalCardId: cardId }),
  addLog: (message) => get().addWarning(message),
  addWarning: (message) => set((s) => ({
    warnings: [...s.warnings, { id: `${Date.now()}-${Math.random()}`, message, timestamp: new Date() }],
  })),
  dismissWarning: (id) => set((s) => ({ warnings: s.warnings.filter(warning => warning.id !== id) })),
  addChatMessage: (msg) => set((s) => ({
    chatMessages: [...s.chatMessages, { ...msg, id: `${Date.now()}-${Math.random()}`, timestamp: new Date() }],
  })),

  reset: () => set(initialState),

  myPlayer: () => {
    const { playerId, gameState } = get();
    return gameState?.players[playerId] ?? null;
  },

  opponentPlayer: () => {
    const { playerId, gameState } = get();
    if (!gameState) return null;
    return Object.values(gameState.players).find(p => p.id !== playerId) ?? null;
  },

  myHand: () => {
    const { playerId, gameState } = get();
    if (!gameState) return [];
    const p = gameState.players[playerId];
    if (!p) return [];
    return p.hand.map(id => gameState.allCards[id]).filter(Boolean) as CardInstance[];
  },

  getCardDef: (cardId) => {
    const { gameState } = get();
    return CARDS[cardId] ?? gameState?.cardDefinitions?.[cardId];
  },

  getMyBattlefields: () => {
    const { playerId, gameState } = get();
    if (!gameState) return [];
    return gameState.battlefields.filter(bf => bf.controllerId === playerId);
  },

  getContestedBattlefields: () => {
    const { playerId, gameState } = get();
    if (!gameState) return [];
    return gameState.battlefields.filter(bf =>
      bf.controllerId !== playerId && bf.units.length > 0
    );
  },
}));

function dedupeLogEntries(entries: PublicGameLogEntry[]): PublicGameLogEntry[] {
  return Array.from(new Map(entries.map(entry => [entry.id, entry])).values());
}

function sortLogEntries(entries: PublicGameLogEntry[]): PublicGameLogEntry[] {
  return [...entries].sort((a, b) => a.timestamp - b.timestamp);
}

function formatGameLogEntries(entries: PublicGameLogEntry[]): string[] {
  return entries.map((entry) => `${new Date(entry.timestamp).toLocaleTimeString()}: ${entry.message}`);
}

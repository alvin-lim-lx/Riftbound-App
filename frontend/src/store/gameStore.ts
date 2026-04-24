/**
 * Game Store — Zustand
 * Central state for the game UI
 */

import { create } from 'zustand';
import type {
  GameState, PlayerState, BattlefieldState, CardInstance,
  Phase, CardDefinition
} from '../shared/types';
import { CARDS } from '../shared/cards';

interface ChatMessage {
  id: string;
  sender: 'player' | 'opponent' | 'system';
  text: string;
  timestamp: Date;
}

interface GameStore {
  // Connection
  playerId: string;
  opponentId: string | null;
  connected: boolean;
  selectedDeckId: string | null;

  // Game state
  gameId: string | null;
  gameState: GameState | null;
  myTurn: boolean;
  phase: Phase;

  // UI state
  selectedCardId: string | null;
  selectedTargetId: string | null;
  targetBattlefieldId: string | null;
  availableActions: string[];
  gameLog: string[];
  chatMessages: ChatMessage[];
  showCardModal: boolean;
  modalCardId: string | null;

  // Lobby
  lobbyId: string | null;
  inLobby: boolean;

  // Actions
  setPlayerId: (id: string) => void;
  setConnected: (connected: boolean) => void;
  setSelectedDeckId: (id: string | null) => void;
  setGameState: (state: GameState) => void;
  setLobby: (lobbyId: string | null) => void;
  selectCard: (cardId: string | null) => void;
  selectTarget: (targetId: string | null) => void;
  selectBattlefield: (bfId: string | null) => void;
  setModalCard: (cardId: string | null) => void;
  addLog: (message: string) => void;
  addChatMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  reset: () => void;

  // Derived
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
  gameLog: [],
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
    const myTurn = gameState.activePlayerId === playerId;
    set({
      gameState,
      gameId: gameState.id,
      myTurn,
      phase: gameState.phase,
    });
  },

  setLobby: (lobbyId) => set({ lobbyId, inLobby: !!lobbyId }),

  selectCard: (cardId) => set({ selectedCardId: cardId, selectedTargetId: null }),
  selectTarget: (targetId) => set({ selectedTargetId: targetId }),
  selectBattlefield: (bfId) => set({ targetBattlefieldId: bfId }),
  setModalCard: (cardId) => set({ showCardModal: !!cardId, modalCardId: cardId }),
  addLog: (message) => set((s) => ({ gameLog: [...s.gameLog, `${new Date().toLocaleTimeString()}: ${message}`] })),
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

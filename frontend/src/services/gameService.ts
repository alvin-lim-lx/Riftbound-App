/**
 * WebSocket Game Service
 * Handles all communication with the game server
 */

import type {
  GameState, GameAction, Lobby,
  GameStartEvent, ActionResultEvent, PhaseChangeEvent, GameOverEvent
} from '../shared/types';

type GameEventHandler = (data: any) => void;

class GameService {
  private ws: WebSocket | null = null;
  private playerId: string = '';
  private gameId: string | null = null;
  private handlers: Map<string, GameEventHandler[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private _pendingGameId: string | null = null; // gameId from game_start, used to re-associate after reconnect

  // ─────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────

  connect(playerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Connect directly to backend WebSocket — Vite proxy WS support is unreliable in Vite 5.x
      // For local dev: backend runs on port 3001 (proxied via Windows netsh from localhost:3001)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = (import.meta as any).env?.VITE_WS_URL || `${protocol}//${window.location.host}/ws`;
      // Fallback: if proxy fails (localhost dev), try direct backend connection
      const directHost = `${protocol}//localhost:3001/ws`;
      let wsUrl = host;
      // Try direct connection if we're on localhost dev server
      if (host.includes('localhost:5173') || host.includes('127.0.0.1:5173')) {
        wsUrl = directHost;
      }

      this.ws = new WebSocket(wsUrl);
      this.playerId = playerId;

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.reconnectAttempts = 0;
        this.send({ type: 'auth', playerId });
        // Re-associate with a game if we have a pending gameId
        if (this._pendingGameId) {
          console.log(`[WS] Re-associating with game ${this._pendingGameId}`);
          // Send a re-associate message — the server will re-link this WS to the game client
          this.send({ type: 'reassociate', playerId: this.playerId, gameId: this._pendingGameId });
        }
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.dispatch(msg);
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        this.attemptReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err);
        reject(err);
      };
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WS] Max reconnect attempts reached');
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    setTimeout(() => {
      console.log(`[WS] Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect(this.playerId).catch(() => {});
    }, delay);
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.gameId = null;
    this._pendingGameId = null;
  }

  // ─────────────────────────────────────────────────────────
  // Send Messages
  // ─────────────────────────────────────────────────────────

  private send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // ─────────────────────────────────────────────────────────
  // Event Registration
  // ─────────────────────────────────────────────────────────

  on(event: string, handler: GameEventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  off(event: string, handler: GameEventHandler) {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, list.filter(h => h !== handler));
  }

  private dispatch(msg: any) {
    // Capture gameId from game_start so we can re-associate on reconnect
    if (msg.type === 'game_start' && msg.gameId) {
      this.gameId = msg.gameId;
      this._pendingGameId = msg.gameId;
      console.log(`[WS] game_start received, gameId=${msg.gameId}`);
    }

    const handlers = this.handlers.get(msg.type) ?? [];
    handlers.forEach(h => h(msg));

    // Also call wildcard handlers
    const wildcards = this.handlers.get('*') ?? [];
    wildcards.forEach(h => h(msg));
  }

  // ─────────────────────────────────────────────────────────
  // Lobby Actions
  // ─────────────────────────────────────────────────────────

  createLobby(deckId?: string, gameMode = 'casual') {
    this.send({
      type: 'create_lobby',
      playerId: this.playerId,
      deckId,
      gameMode,
    });
  }

  joinLobby(lobbyId: string, deckId?: string) {
    this.send({
      type: 'join_lobby',
      playerId: this.playerId,
      lobbyId,
      deckId,
    });
  }

  leaveLobby() {
    this.send({ type: 'leave_lobby' });
  }

  startGame() {
    this.send({ type: 'start_game' });
  }

  startVsAI(deckId?: string) {
    this.send({
      type: 'start_vs_ai',
      playerId: this.playerId,
      deckId,
      gameMode: 'casual',
    });
  }

  // ─────────────────────────────────────────────────────────
  // Game Actions
  // ─────────────────────────────────────────────────────────

  submitAction(action: GameAction) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.error('[WS] submitAction called but WS not OPEN, readyState=', this.ws?.readyState);
      return;
    }
    this.send({
      type: 'submit_action',
      playerId: this.playerId,
      action,
    });
  }

  pass() {
    this.send({ type: 'pass' });
  }

  sendChat(text: string) {
    this.send({ type: 'chat_message', playerId: this.playerId, text });
  }

  // ─────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get currentPlayerId(): string {
    return this.playerId;
  }

  get currentGameId(): string | null {
    return this.gameId;
  }
}

export const gameService = new GameService();

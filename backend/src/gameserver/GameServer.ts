/**
 * Game Server — WebSocket + HTTP API
 * ==================================
 * Manages live games, lobbies, matchmaking, and WebSocket broadcasting.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server as HttpServer } from 'http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import type {
  GameState, GameAction, Lobby, GameEvent,
  GameStartEvent, ActionResultEvent, PhaseChangeEvent, GameOverEvent
} from '../../shared/src/types';
import {
  createGame, executeAction, resolveShowdown, advancePhase,
  canAutoAdvancePhase, getLegalActions, type ActionResult
} from '../engine/GameEngine';
import { RulesBasedAI } from '../ai/RulesBasedAI';
import { CARDS } from '../../shared/src/cards';
import { randomId } from '../engine/utils';
import { createDeckRouter } from '../deck/DeckRoutes';
import { DeckManager } from '../deck/DeckManager';
import { createAuthRouter } from '../routes/auth';
import '../db/database'; // initializes SQLite schema on startup

interface ConnectedClient {
  ws: WebSocket;
  playerId: string;
  lobbyId: string | null;
  gameId: string | null;
}

interface LiveGame {
  id: string;
  state: GameState;
  clients: Map<string, WebSocket>;  // playerId -> ws
  ais: Map<string, RulesBasedAI>;   // playerId -> AI instance
  aiTimer: NodeJS.Timeout | null;
  isRunning: boolean;
}

// ============================================================
// Server Class
// ============================================================

export class GameServer {
  private app: express.Application;
  private httpServer: HttpServer;
  private wss: WebSocketServer;
  private clients: Map<WebSocket, ConnectedClient> = new Map();
  private lobbies: Map<string, Lobby> = new Map();
  private liveGames: Map<string, LiveGame> = new Map();

  constructor(port: number = 3001) {
    this.app = express();
    this.app.use(express.json());
    this.app.use(cors({ origin: '*' }));
    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.setupRoutes();
    this.setupWebSocket();

    this.httpServer.listen(port, () => {
      console.log(`[GameServer] Running on http://localhost:${port}`);
      console.log(`[GameServer] WebSocket on ws://localhost:${port}`);
    });
  }

  // ============================================================
  // HTTP Routes
  // ============================================================

  private setupRoutes() {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', games: this.liveGames.size, lobbies: this.lobbies.size });
    });

    // Auth routes
    this.app.use('/api/auth', createAuthRouter());

    // Deck routes
    this.app.use('/api/decks', createDeckRouter());

    // Card data
    this.app.get('/api/cards', (_req: Request, res: Response) => {
      res.json(Object.values(CARDS));
    });

    this.app.get('/api/cards/:id', (req: Request, res: Response) => {
      const card = CARDS[req.params.id];
      if (!card) return res.status(404).json({ error: 'Card not found' });
      res.json(card);
    });

    // Lobby management
    this.app.post('/api/lobbies', (req: Request, res: Response) => {
      const { playerId, playerName, gameMode, deckId, isAI } = req.body;
      if (!playerId || !playerName) {
        return res.status(400).json({ error: 'playerId and playerName required' });
      }

      const lobbyId = randomId();
      const lobby: Lobby = {
        id: lobbyId,
        hostId: playerId,
        guestId: isAI ? 'ai_bot' : null,
        gameMode: gameMode ?? 'casual',
        hostDeckId: deckId ?? null,
        guestDeckId: null,
        status: 'waiting',
        createdAt: Date.now(),
      };
      this.lobbies.set(lobbyId, lobby);

      res.json({ lobby });
    });

    this.app.get('/api/lobbies/:id', (req: Request, res: Response) => {
      const lobby = this.lobbies.get(req.params.id);
      if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
      res.json({ lobby });
    });

    this.app.post('/api/lobbies/:id/join', (req: Request, res: Response) => {
      const { playerId, playerName, deckId, isAI } = req.body;
      const lobby = this.lobbies.get(req.params.id);
      if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
      if (lobby.status !== 'waiting') return res.status(400).json({ error: 'Lobby already started' });

      lobby.guestId = isAI ? 'ai_bot' : playerId;
      lobby.guestDeckId = deckId ?? null;
      if (!isAI) lobby.status = 'ready';

      // Start game immediately once both players are in the lobby
      this.startGame(lobby);

      res.json({ lobby });
    });

    this.app.post('/api/games/:id/action', (req: Request, res: Response) => {
      const { playerId, action } = req.body;
      const game = this.liveGames.get(req.params.id);
      if (!game) return res.status(404).json({ error: 'Game not found' });

      const result = executeAction(game.state, action);
      if (result.success && result.newState) {
        game.state = result.newState;
        this.broadcastGameState(game);
      }

      res.json({ success: result.success, error: result.error });
    });

    this.app.get('/api/games/:id', (req: Request, res: Response) => {
      const game = this.liveGames.get(req.params.id);
      if (!game) return res.status(404).json({ error: 'Game not found' });
      res.json({ state: this.sanitizeState(game.state, req.query.playerId as string) });
    });
  }

  // ============================================================
  // WebSocket Setup
  // ============================================================

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WS] Client connected');

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(ws, msg);
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      });

      ws.on('close', () => {
        const client = this.clients.get(ws);
        if (client) {
          console.log(`[WS] Player ${client.playerId} disconnected`);
          this.clients.delete(ws);
        }
      });

      ws.on('error', (err) => {
        console.error('[WS] Error:', err);
      });
    });
  }

  private handleMessage(ws: WebSocket, msg: any) {
    const client = this.clients.get(ws);

    switch (msg.type) {
      case 'auth': {
        // Authenticate player
        const playerId = msg.playerId ?? `guest_${randomId()}`;
        this.clients.set(ws, { ws, playerId, lobbyId: null, gameId: null });
        this.send(ws, { type: 'auth_ok', playerId });
        break;
      }

      case 'reassociate': {
        // Re-associate a reconnected WS with an existing game
        if (!client) return this.sendError(ws, 'Not authenticated');
        const { gameId } = msg;
        if (!gameId) return this.sendError(ws, 'Missing gameId');

        const liveGame = this.liveGames.get(gameId);
        if (!liveGame) return this.sendError(ws, 'Game not found');

        // Check the player is actually in this game
        if (!liveGame.clients.has(client.playerId)) {
          return this.sendError(ws, 'Player not in this game');
        }

        // Re-link the WS to the game client
        liveGame.clients.set(client.playerId, ws);
        // Update the client's gameId
        const updatedClient = { ...client, gameId };
        this.clients.set(ws, updatedClient);

        console.log(`[reassociate] playerId=${client.playerId} re-associated with game=${gameId}`);

        // Send the current game state to the reconnected client
        const sanitized = this.sanitizeState(liveGame.state, client.playerId);
        this.send(ws, {
          type: 'game_state_update',
          gameId: liveGame.id,
          state: sanitized,
          timestamp: Date.now(),
        });
        break;
      }

      case 'start_vs_ai': {
        if (!client) return this.sendError(ws, 'Not authenticated');

        console.log('[DEBUG] start_vs_ai msg.deckId:', msg.deckId, 'client.playerId:', client.playerId);

        const lobbyId = randomId();
        const lobby: Lobby = {
          id: lobbyId,
          hostId: client.playerId,
          guestId: 'ai_bot',
          gameMode: msg.gameMode ?? 'casual',
          hostDeckId: msg.deckId ?? null,
          guestDeckId: null,
          status: 'waiting',
          createdAt: Date.now(),
        };
        this.lobbies.set(lobbyId, lobby);
        this.clients.set(ws, { ...client!, lobbyId });
        this.startGame(lobby);
        break;
      }

      case 'create_lobby': {
        const playerId = client?.playerId ?? msg.playerId;
        if (!playerId) return this.sendError(ws, 'Not authenticated');

        const lobbyId = randomId();
        const lobby: Lobby = {
          id: lobbyId,
          hostId: playerId,
          guestId: null,
          gameMode: msg.gameMode ?? 'casual',
          hostDeckId: msg.deckId ?? null,
          guestDeckId: null,
          status: 'waiting',
          createdAt: Date.now(),
        };
        this.lobbies.set(lobbyId, lobby);
        this.clients.set(ws, { ...client!, lobbyId });
        this.send(ws, { type: 'lobby_created', lobby });
        break;
      }

      case 'join_lobby': {
        if (!client) return this.sendError(ws, 'Not authenticated');
        const { lobbyId, deckId, isAI } = msg;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return this.sendError(ws, 'Lobby not found');
        if (lobby.guestId) return this.sendError(ws, 'Lobby full');

        lobby.guestId = isAI ? 'ai_bot' : client.playerId;
        lobby.guestDeckId = deckId ?? null;

        // Notify all in lobby
        this.broadcastLobby(lobby);

        // Start game
        if (lobby.guestId) {
          this.startGame(lobby);
        }
        break;
      }

      case 'leave_lobby': {
        if (!client) return;
        const lobby = this.lobbies.get(client.lobbyId ?? '');
        if (lobby) {
          this.lobbies.delete(lobby.id);
        }
        this.clients.set(ws, { ...client!, lobbyId: null });
        break;
      }

      case 'start_game': {
        if (!client) return;
        const lobby = this.lobbies.get(client.lobbyId ?? '');
        if (!lobby) return this.sendError(ws, 'Lobby not found');
        if (lobby.hostId !== client.playerId) return this.sendError(ws, 'Only host can start');

        this.startGame(lobby);
        break;
      }

      case 'submit_action': {
        if (!client) return this.sendError(ws, 'Not authenticated');
        if (!client.gameId) return this.sendError(ws, 'Not in a game');

        const game = this.liveGames.get(client.gameId);
        if (!game) return this.sendError(ws, 'Game not found');

        const action = msg.action as GameAction;
        console.log(`[submit_action] playerId=${action.playerId} type=${action.type} phase=${action.phase} turn=${action.turn}`);
        console.log(`[submit_action] client.playerId=${client.playerId} client.gameId=${client.gameId}`);
        console.log(`[submit_action] game.state.phase=${game.state.phase} game.state.activePlayerId=${game.state.activePlayerId}`);

        if (action.playerId !== client.playerId) {
          return this.sendError(ws, 'Not your action');
        }

        const result = executeAction(game.state, action);

        if (!result.success) {
          this.send(ws, { type: 'action_result', success: false, error: result.error });
          return;
        }

        if (result.newState) {
          game.state = result.newState;

          // Handle showdown phase
          if (game.state.phase === 'Showdown') {
            const { attackerId, targetBattlefieldId } = action.payload as any;
            const showdownResult = resolveShowdown(game.state, attackerId, targetBattlefieldId);
            if (showdownResult.newState) {
              game.state = showdownResult.newState;
            }
          }

          this.broadcastGameState(game);

          // Handle game over
          if (game.state.phase === 'GameOver' && game.state.winner) {
            this.endGame(game);
          } else if (result.success) {
            // After any action (including mulligan), kick off auto-advance
            // for A-B-C-D phases so the game flows without player input.
            // scheduleAIMove will return early if canAutoAdvancePhase is true,
            // so we must trigger advancePhase here to actually drive the chain.
            if (canAutoAdvancePhase(game.state)) {
              game.state = advancePhase(game.state);
              this.broadcastGameState(game);
            }
            this.scheduleAIMove(game);
          }
        }
        break;
      }

      case 'pass': {
        if (!client?.gameId) return;
        const game = this.liveGames.get(client.gameId);
        if (!game) return;

        const passAction: GameAction = {
          id: randomId(),
          type: 'Pass',
          playerId: client.playerId,
          payload: {},
          turn: game.state.turn,
          phase: game.state.phase,
          timestamp: Date.now(),
        };

        const result = executeAction(game.state, passAction);
        if (result.success && result.newState) {
          game.state = result.newState;
          this.broadcastGameState(game);
          this.scheduleAIMove(game);
        }
        break;
      }
    }
  }

  // ============================================================
  // Game Lifecycle
  // ============================================================

  private startGame(lobby: Lobby) {
    const playerIds = [lobby.hostId, lobby.guestId!].filter(Boolean);
    const playerNames = ['Player 1', 'Player 2'];

    // Replace AI placeholder with actual AI ID
    const actualPlayerIds = playerIds.map(id => id === 'ai_bot' ? `ai_${randomId()}` : id);

    // Build player deck configs from stored deck IDs
    const playerDecks: Record<string, { legendId: string; chosenChampionCardId: string; cardIds: string[]; runeIds?: string[]; battlefieldIds?: string[]; sideboardIds?: string[] }> = {};
    for (const pid of actualPlayerIds) {
      const isHost = pid === actualPlayerIds[0];
      const deckId = isHost ? lobby.hostDeckId : lobby.guestDeckId;
      console.log(`[startGame] pid=${pid} isHost=${isHost} deckId=${deckId}`);
      if (deckId) {
        const deck = DeckManager.get(deckId);
        console.log(`[startGame] DeckManager.get(${deckId}) = ${deck ? 'FOUND' : 'NOT FOUND'}`);
        if (deck) {
          console.log(`[startGame] Found deck: ${deck.name} legend=${deck.legendId} champ=${deck.chosenChampionCardId} cardIds=${deck.cardIds.length}`);
          playerDecks[pid] = {
            legendId: deck.legendId,
            chosenChampionCardId: deck.chosenChampionCardId,
            cardIds: deck.cardIds,
            runeIds: deck.runeIds ?? [],
            battlefieldIds: deck.battlefieldIds ?? [],
            sideboardIds: deck.sideboardIds ?? [],
          };
        } else {
          console.log(`[startGame] Deck NOT found for id=${deckId}`);
        }
      } else if (!isHost) {
        // AI player with no deck — pick a random AI pre-built deck
        const aiDeck = DeckManager.getRandomAiDeck();
        if (aiDeck) {
          playerDecks[pid] = {
            legendId: aiDeck.legendId,
            chosenChampionCardId: aiDeck.chosenChampionCardId,
            cardIds: aiDeck.cardIds,
            runeIds: aiDeck.runeIds ?? [],
            battlefieldIds: aiDeck.battlefieldIds ?? [],
            sideboardIds: aiDeck.sideboardIds ?? [],
          };
        }
      }
    }

    const gameState = createGame(actualPlayerIds, playerNames, {
      scoreLimit: 8,
      isPvP: !lobby.guestId?.startsWith('ai_'),
      playerDecks: Object.keys(playerDecks).length > 0 ? playerDecks : undefined,
    });

    // Enter Setup phase — this triggers the setup->Mulligan->Awaken sequence.
    // createGame() already set phase='Setup' and randomly chose first player.
    const { enterPhase } = require('../engine/GameEngine');
    const gameStateWithPhase = enterPhase(gameState, 'Setup');

    const liveGame: LiveGame = {
      id: gameStateWithPhase.id,
      state: gameStateWithPhase,
      clients: new Map(),
      ais: new Map(),
      aiTimer: null,
      isRunning: true,
    };

    this.liveGames.set(gameStateWithPhase.id, liveGame);

    // Register clients
    for (const [ws, c] of this.clients) {
      if (actualPlayerIds.includes(c.playerId)) {
        c.gameId = gameStateWithPhase.id;
        liveGame.clients.set(c.playerId, ws);
      }
    }

    // Setup AI if present
    for (const pid of actualPlayerIds) {
      if (pid.startsWith('ai_')) {
        const ai = new RulesBasedAI(pid);
        liveGame.ais.set(pid, ai);
      }
    }

    // Also send game_start to WebSocket clients who may not be in liveGame.clients
    // (happens when lobby was created via REST instead of WebSocket)
    for (const [ws, c] of this.clients) {
      if (actualPlayerIds.includes(c.playerId)) {
        const opponentId = actualPlayerIds.find(id => id !== c.playerId);
        const yourTurn = c.playerId === gameStateWithPhase.activePlayerId;
        const startEvent: GameStartEvent = {
          gameId: gameStateWithPhase.id,
          playerId: c.playerId,
          opponentId: opponentId!,
          initialState: this.sanitizeState(gameStateWithPhase, c.playerId),
          yourTurn,
        };
        this.send(ws, { type: 'game_start', ...startEvent });
      }
    }

    lobby.status = 'starting';

    // Send game start to all players
    for (const [pid, ws] of liveGame.clients) {
      const opponentId = actualPlayerIds.find(id => id !== pid);
      const yourTurn = pid === gameStateWithPhase.activePlayerId;
      const startEvent: GameStartEvent = {
        gameId: gameStateWithPhase.id,
        playerId: pid,
        opponentId: opponentId!,
        initialState: this.sanitizeState(gameStateWithPhase, pid),
        yourTurn,
      };
      this.send(ws, { type: 'game_start', ...startEvent });
    }

    // If first player is AI, schedule their move
    this.scheduleAIMove(liveGame);

    // Clean up lobby
    this.lobbies.delete(lobby.id);
  }

  private scheduleAIMove(game: LiveGame) {
    if (game.aiTimer) clearTimeout(game.aiTimer);

    const isAITurn = game.state.activePlayerId.startsWith('ai_');
    if (!isAITurn || !game.isRunning) return;

    // Don't auto-schedule AI moves during A-B-C-D phases — those should
    // auto-advance automatically unless there are pending triggers.
    // AI will take real actions (PlayUnit, Pass, etc.) via getLegalActions.
    if (canAutoAdvancePhase(game.state)) return;

    game.aiTimer = setTimeout(() => {
      const ai = game.ais.get(game.state.activePlayerId);
      if (!ai) return;

      const action = ai.decide(game.state);
      action.turn = game.state.turn;
      action.phase = game.state.phase;

      console.log(`[AI] Taking action: ${action.type}`);

      const result = executeAction(game.state, action);

      if (result.success && result.newState) {
        game.state = result.newState;

        if (game.state.phase === 'Showdown') {
          const { attackerId, targetBattlefieldId } = action.payload as any;
          const sr = resolveShowdown(game.state, attackerId, targetBattlefieldId);
          if (sr.newState) game.state = sr.newState;
        }

        this.broadcastGameState(game);

        if (game.state.phase === 'GameOver' && game.state.winner) {
          this.endGame(game);
        } else {
          // Continue AI turns if still AI's turn
          this.scheduleAIMove(game);
        }
      }
    }, 800); // 800ms delay for natural feel
  }

  private broadcastGameState(game: LiveGame) {
    console.log(`[broadcastGameState] phase=${game.state.phase} activePlayerId=${game.state.activePlayerId} clients.size=${game.clients.size}`);
    const event = {
      type: 'game_state_update',
      gameId: game.id,
      timestamp: Date.now(),
    };

    for (const [pid, ws] of game.clients) {
      const sanitized = this.sanitizeState(game.state, pid);
      console.log(`[broadcastGameState] sending to pid=${pid} phase=${sanitized.phase}`);
      this.send(ws, { ...event, state: sanitized });
    }
  }

  private broadcastLobby(lobby: Lobby) {
    const data = { type: 'lobby_update', lobby };
    for (const [, c] of this.clients) {
      if (c.lobbyId === lobby.id) {
        this.send(c.ws, data);
      }
    }
  }

  private endGame(game: LiveGame) {
    game.isRunning = false;
    if (game.aiTimer) clearTimeout(game.aiTimer);

    const event: GameOverEvent = {
      winnerId: game.state.winner!,
      reason: 'score',
    };

    for (const ws of game.clients.values()) {
      this.send(ws, { type: 'game_over', ...event });
    }

    // Cleanup after delay
    setTimeout(() => {
      this.liveGames.delete(game.id);
    }, 60000);
  }

  // ============================================================
  // State Helpers
  // ============================================================

  /**
   * Remove hidden card information for opponent privacy
   */
  private sanitizeState(state: GameState, viewerPlayerId: string): GameState {
    const sanitized = { ...state };
    sanitized.allCards = { ...state.allCards };

    for (const [instId, card] of Object.entries(sanitized.allCards)) {
      // Hide opponent's face-down cards
      if (card.owner_hidden && card.ownerId !== viewerPlayerId) {
        sanitized.allCards[instId] = {
          ...card,
          cardId: 'Hidden',
          facing: 'down',
          currentStats: {},
          location: card.location, // Preserve location for AI logic
        };
      }
    }

    // Hide opponent's hand (but keep count)
    const opponent = Object.values(state.players).find(p => p.id !== viewerPlayerId);
    if (opponent) {
      sanitized.players = { ...state.players };
      sanitized.players[opponent.id] = {
        ...sanitized.players[opponent.id],
        hand: [], // Don't reveal opponent's hand
      };
    }

    return sanitized;
  }

  private send(ws: WebSocket, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private sendError(ws: WebSocket, message: string) {
    this.send(ws, { type: 'error', message });
  }
}

// Start server
new GameServer(3001);

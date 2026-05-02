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
  GameStartEvent, ActionResultEvent, PhaseChangeEvent, GameOverEvent,
  GameLogEntry, PublicGameLogEntry, SystemLogEntry
} from '../../shared/src/types';
import {
  createGame, executeAction,
  advancePhase,
  canAutoAdvancePhase, getLegalActions, type ActionResult
} from '../engine/GameEngine';

/**
 * Auto-advance loop for A-B-C-D phases.
 * After each action, keeps advancing through Awaken→Beginning→Channel→Draw
 * until either the effect stack blocks further advancement or we reach Action phase.
 */
function autoAdvanceABCDPhases(game: LiveGame): void {
  while (canAutoAdvancePhase(game.state)) {
    const nextState = advancePhase(game.state);
    game.state = nextState;
    if (game.state.phase === 'GameOver') return;
  }
}
import { RulesBasedAI } from '../ai/RulesBasedAI';
import { CARDS } from '../../shared/src/cards';
import { randomId } from '../engine/utils';
import { createDeckRouter } from '../deck/DeckRoutes';
import { DeckManager } from '../deck/DeckManager';
import { createAuthRouter } from '../routes/auth';
import '../db/database'; // initializes SQLite schema on startup
import { GameDebugLogger } from './GameDebugLogger';

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
  lastLogIndex: number;  // tracks actionLog length at last broadcast; incremental game_log events use this
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
  private debugLogger = new GameDebugLogger();

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

      const stateBefore = game.state;
      const logIndexBefore = game.state.actionLog.length;
      const result = executeAction(game.state, action);
      if (!result.success || !result.newState) {
        console.warn(`[AI] Action failed: ${action.type} phase=${game.state.phase} error=${result.error ?? 'unknown error'}`);
        const fallbackAction: GameAction = {
          id: randomId(),
          type: 'Pass',
          playerId: game.state.activePlayerId,
          payload: {},
          turn: game.state.turn,
          phase: game.state.phase,
          timestamp: Date.now(),
        };
        const fallbackResult = executeAction(game.state, fallbackAction);
        if (fallbackResult.success && fallbackResult.newState) {
          game.state = fallbackResult.newState;
          if (game.state.phase !== 'GameOver') {
            const beforeAutoAdvance = game.state;
            autoAdvanceABCDPhases(game);
            if (beforeAutoAdvance !== game.state) {
              this.debugLogger.log({
                event: 'auto_advance',
                gameId: game.id,
                actorPlayerId: action.playerId,
                action,
                publicLogEntries: game.state.actionLog.slice(beforeAutoAdvance.actionLog.length),
                stateBefore: beforeAutoAdvance,
                stateAfter: game.state,
              });
            }
          }

          this.debugLogger.log({
            event: 'action_accepted',
            gameId: game.id,
            actorPlayerId: action.playerId,
            action,
            result: { success: true, sideEffects: fallbackResult.sideEffects },
            publicLogEntries: game.state.actionLog.slice(logIndexBefore),
            stateBefore,
            stateAfter: game.state,
          });
          this.broadcastGameLog(game);
          this.broadcastGameState(game);
        }
        if (game.state.phase !== 'GameOver') {
          this.scheduleAIMove(game);
        }
        return;
      }

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
          if (client.gameId) {
            this.debugLogger.log({
              event: 'player_disconnected',
              gameId: client.gameId,
              actorPlayerId: client.playerId,
              stateAfter: this.liveGames.get(client.gameId)?.state,
            });
          }
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
        this.debugLogger.log({
          event: 'player_reassociated',
          gameId: liveGame.id,
          actorPlayerId: client.playerId,
          stateAfter: liveGame.state,
        });

        // Send the current game state to the reconnected client
        const sanitized = this.sanitizeState(liveGame.state, client.playerId);
        this.send(ws, {
          type: 'game_state_update',
          gameId: liveGame.id,
          state: sanitized,
          timestamp: Date.now(),
        });
        this.send(ws, {
          type: 'game_log',
          gameId: liveGame.id,
          entries: this.getPublicLogEntriesForViewer(liveGame.state.actionLog, liveGame.state, client.playerId),
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
          this.debugLogger.log({
            event: 'action_rejected',
            gameId: game.id,
            actorPlayerId: client.playerId,
            action,
            result: { success: false, error: 'Not your action' },
            stateBefore: game.state,
          });
          return this.sendError(ws, 'Not your action');
        }

        const stateBefore = game.state;
        const logIndexBefore = game.state.actionLog.length;
        this.debugLogger.log({
          event: 'action_received',
          gameId: game.id,
          actorPlayerId: action.playerId,
          action,
          stateBefore,
        });

        const result = executeAction(game.state, action);

        if (!result.success) {
          this.debugLogger.log({
            event: 'action_rejected',
            gameId: game.id,
            actorPlayerId: action.playerId,
            action,
            result: { success: false, error: result.error },
            stateBefore,
          });
          this.send(ws, { type: 'action_result', success: false, error: result.error });
          return;
        }

        if (result.newState) {
          game.state = result.newState;

          // Auto-advance through A-B-C-D phases (Awaken→Beginning→Channel→Draw)
          // when effect stack is empty, BEFORE broadcasting state
          if (game.state.phase !== 'GameOver') {
            const beforeAutoAdvance = game.state;
            autoAdvanceABCDPhases(game);
            if (beforeAutoAdvance !== game.state) {
              this.debugLogger.log({
                event: 'auto_advance',
                gameId: game.id,
                actorPlayerId: action.playerId,
                action,
                publicLogEntries: game.state.actionLog.slice(beforeAutoAdvance.actionLog.length),
                stateBefore: beforeAutoAdvance,
                stateAfter: game.state,
              });
            }
          }

          this.debugLogger.log({
            event: 'action_accepted',
            gameId: game.id,
            actorPlayerId: action.playerId,
            action,
            result: { success: true, sideEffects: result.sideEffects },
            publicLogEntries: game.state.actionLog.slice(logIndexBefore),
            stateBefore,
            stateAfter: game.state,
          });

          // Broadcast incremental log entries first so clients can append
          this.broadcastGameLog(game);
          this.broadcastGameState(game);

          // Handle game over
          if (game.state.phase === 'GameOver' && game.state.winner) {
            this.endGame(game);
          } else if (result.success) {
            // If action succeeded and not game over, auto-advance if AI's turn
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

        const stateBefore = game.state;
        const logIndexBefore = game.state.actionLog.length;
        this.debugLogger.log({
          event: 'action_received',
          gameId: game.id,
          actorPlayerId: passAction.playerId,
          action: passAction,
          stateBefore,
          detail: { source: 'pass_message' },
        });

        const result = executeAction(game.state, passAction);
        if (result.success && result.newState) {
          game.state = result.newState;

          // Auto-advance through A-B-C-D phases after pass
          if (game.state.phase !== 'GameOver') {
            autoAdvanceABCDPhases(game);
          }

          this.broadcastGameLog(game);
          this.broadcastGameState(game);
          this.debugLogger.log({
            event: 'action_accepted',
            gameId: game.id,
            actorPlayerId: passAction.playerId,
            action: passAction,
            result: { success: true, sideEffects: result.sideEffects },
            publicLogEntries: game.state.actionLog.slice(logIndexBefore),
            stateBefore,
            stateAfter: game.state,
          });
          this.scheduleAIMove(game);
        } else {
          this.debugLogger.log({
            event: 'action_rejected',
            gameId: game.id,
            actorPlayerId: passAction.playerId,
            action: passAction,
            result: { success: false, error: result.error },
            stateBefore,
          });
        }
        break;
      }

      case 'chat_message': {
        if (!client) return;
        const { text } = msg;
        if (!text || typeof text !== 'string') return;

        // Echo the message back to the sender (and to opponent in PvP games)
        const echo = {
          type: 'chat_message',
          playerId: client.playerId,
          text: text.slice(0, 200),
          timestamp: Date.now(),
        };

        this.send(ws, echo);

        // If in a game, also send to the opponent
        if (client.gameId) {
          const game = this.liveGames.get(client.gameId);
          if (game) {
            for (const [pid, opponentWs] of game.clients) {
              if (pid !== client.playerId && opponentWs.readyState === WebSocket.OPEN) {
                this.send(opponentWs, echo);
              }
            }
          }
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
      lastLogIndex: gameStateWithPhase.actionLog.length,
    };

    this.liveGames.set(gameStateWithPhase.id, liveGame);
    this.debugLogger.log({
      event: 'game_created',
      gameId: liveGame.id,
      stateAfter: gameStateWithPhase,
      publicLogEntries: gameStateWithPhase.actionLog,
      detail: {
        lobbyId: lobby.id,
        playerIds: actualPlayerIds,
        aiPlayerIds: actualPlayerIds.filter(id => id.startsWith('ai_')),
        hostDeckId: lobby.hostDeckId,
        guestDeckId: lobby.guestDeckId,
      },
    });

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
          initialLog: this.getPublicLogEntriesForViewer(gameStateWithPhase.actionLog, gameStateWithPhase, c.playerId),
          yourTurn,
        };
        this.send(ws, { type: 'game_start', ...startEvent });
        this.debugLogger.log({
          event: 'game_start_sent',
          gameId: liveGame.id,
          actorPlayerId: c.playerId,
          stateAfter: gameStateWithPhase,
          detail: { opponentId, yourTurn, path: 'client_scan' },
        });
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
        initialLog: this.getPublicLogEntriesForViewer(gameStateWithPhase.actionLog, gameStateWithPhase, pid),
        yourTurn,
      };
      this.send(ws, { type: 'game_start', ...startEvent });
      this.debugLogger.log({
        event: 'game_start_sent',
        gameId: liveGame.id,
        actorPlayerId: pid,
        stateAfter: gameStateWithPhase,
        detail: { opponentId, yourTurn, path: 'live_game_clients' },
      });
    }

    // If first player is AI, schedule their move
    this.scheduleAIMove(liveGame);

    // Clean up lobby
    this.lobbies.delete(lobby.id);
  }

  private scheduleAIMove(game: LiveGame) {
    if (game.aiTimer) clearTimeout(game.aiTimer);

    const resolveAIActorId = () => {
      const pendingAssignmentPlayerId = game.state.pendingCombatDamageAssignment?.assigningPlayerId;
      if (pendingAssignmentPlayerId) return pendingAssignmentPlayerId.startsWith('ai_') ? pendingAssignmentPlayerId : null;
      const focusPlayerId = game.state.phase === 'Showdown' ? game.state.showdown?.focusPlayerId : null;
      if (focusPlayerId) return focusPlayerId.startsWith('ai_') ? focusPlayerId : null;
      return game.state.activePlayerId.startsWith('ai_') ? game.state.activePlayerId : null;
    };

    const aiActorId = resolveAIActorId();
    const isAITurn = Boolean(aiActorId);
    if (!isAITurn || !game.isRunning) return;

    // Don't auto-schedule AI moves during A-B-C-D phases — those should
    // auto-advance automatically unless there are pending triggers.
    // AI will take real actions (PlayUnit, Pass, etc.) via getLegalActions.
    if (canAutoAdvancePhase(game.state)) return;

    game.aiTimer = setTimeout(() => {
      const currentAIActorId = resolveAIActorId();
      if (!currentAIActorId) return;

      const ai = game.ais.get(currentAIActorId);
      if (!ai) return;

      const action = ai.decide(game.state);
      action.turn = game.state.turn;
      action.phase = game.state.phase;

      console.log(`[AI] Taking action: ${action.type}`);

      const stateBefore = game.state;
      const logIndexBefore = game.state.actionLog.length;
      this.debugLogger.log({
        event: 'ai_action_selected',
        gameId: game.id,
        actorPlayerId: currentAIActorId,
        action,
        stateBefore,
      });

      const result = executeAction(game.state, action);

      if (result.success && result.newState) {
        game.state = result.newState;

        if (game.state.phase !== 'GameOver') {
          autoAdvanceABCDPhases(game);
        }

        this.debugLogger.log({
          event: 'action_accepted',
          gameId: game.id,
          actorPlayerId: currentAIActorId,
          action,
          result: { success: true, sideEffects: result.sideEffects },
          publicLogEntries: game.state.actionLog.slice(logIndexBefore),
          stateBefore,
          stateAfter: game.state,
          detail: { source: 'ai' },
        });

        this.broadcastGameLog(game);
        this.broadcastGameState(game);

        if (game.state.phase === 'GameOver' && game.state.winner) {
          this.endGame(game);
        } else {
          // Continue AI turns if still AI's turn
          this.scheduleAIMove(game);
        }
      } else {
        this.debugLogger.log({
          event: 'action_rejected',
          gameId: game.id,
          actorPlayerId: currentAIActorId,
          action,
          result: { success: false, error: result.error },
          stateBefore,
          detail: { source: 'ai' },
        });
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

    this.debugLogger.log({
      event: 'game_state_broadcast',
      gameId: game.id,
      stateAfter: game.state,
      detail: { recipients: Array.from(game.clients.keys()) },
    });
  }

  /**
   * Broadcasts incremental log entries as a separate real-time event.
   * Called after auto-advance phases add logs, but before the full game_state_update
   * so clients can append to their log store immediately.
   */
  private broadcastGameLog(game: LiveGame) {
    const newEntries = game.state.actionLog.slice(game.lastLogIndex);
    if (newEntries.length === 0) return;

    const broadcastSummaries: Array<{ playerId: string; entryCount: number; entryIds: string[] }> = [];
    for (const [pid, ws] of game.clients) {
      const entries = this.getPublicLogEntriesForViewer(newEntries, game.state, pid);
      broadcastSummaries.push({ playerId: pid, entryCount: entries.length, entryIds: entries.map(entry => entry.id) });
      if (entries.length === 0) continue;
      this.send(ws, {
        type: 'game_log',
        gameId: game.id,
        entries,
        timestamp: Date.now(),
      });
    }

    this.debugLogger.log({
      event: 'game_log_broadcast',
      gameId: game.id,
      publicLogEntries: newEntries,
      stateAfter: game.state,
      detail: { broadcasts: broadcastSummaries },
    });

    game.lastLogIndex = game.state.actionLog.length;
  }

  private getPublicLogEntriesForViewer(
    entries: GameLogEntry[],
    state: GameState,
    viewerPlayerId: string
  ): PublicGameLogEntry[] {
    return entries
      .map(entry => this.toPublicLogEntry(entry, state, viewerPlayerId))
      .filter((entry): entry is PublicGameLogEntry => Boolean(entry));
  }

  private toPublicLogEntry(
    entry: GameLogEntry,
    state: GameState,
    viewerPlayerId: string
  ): PublicGameLogEntry | null {
    if (!('message' in entry)) return null;

    const type = entry.type;
    const detail = entry.detail ?? {};
    const playerId = entry.playerId;
    const message = entry.message;

    if (type === 'PhaseChange' || type === 'Channel' || type === 'Hide') return null;
    if (type === 'Combat' && /assign(?:ing|ed) .*combat damage/i.test(message)) return null;
    if (type === 'System' && /Awaken/i.test(message)) return null;

    if (type === 'Draw') {
      const isSelfOnly = detail._isSelfOnly === true;
      const isViewerActor = playerId === viewerPlayerId;
      if (isSelfOnly !== isViewerActor) return null;
    }

    const isKnownPublicType = [
      'GameStart',
      'TurnChange',
      'Mulligan',
      'Draw',
      'Move',
      'Showdown',
      'Combat',
      'Focus',
      'Score',
      'Equip',
      'ReactFromHidden',
      'GameOver',
    ].includes(type);

    const isSupportedSystem =
      type === 'System' &&
      (
        ['PlayUnit', 'PlaySpell', 'PlayGear'].includes(String(detail.actionType)) ||
        /was killed\.$/i.test(message) ||
        /passed focus\.$/i.test(message)
      );

    if (!isKnownPublicType && !isSupportedSystem) return null;

    return {
      id: entry.id,
      type,
      message: this.normalizePublicMessage(message, state, viewerPlayerId),
      turn: entry.turn,
      phase: entry.phase,
      timestamp: entry.timestamp,
    };
  }

  private normalizePublicMessage(message: string, state: GameState, viewerPlayerId: string): string {
    const viewerName = state.players[viewerPlayerId]?.name;
    if (!viewerName) return message;
    return message.replace(new RegExp(`^${this.escapeRegExp(viewerName)}\\b`), 'You');
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

    const winnerName = game.state.players[game.state.winner!]?.name ?? game.state.winner!;
    if (!game.state.actionLog.some(entry => 'message' in entry && entry.type === 'GameOver' && /Game over:/i.test(entry.message))) {
      game.state.actionLog.push({
        id: randomId(),
        type: 'GameOver',
        playerId: game.state.winner!,
        message: `Game over: ${winnerName} wins`,
        turn: game.state.turn,
        phase: game.state.phase,
        timestamp: Date.now(),
        detail: { winnerId: game.state.winner },
      });
      this.broadcastGameLog(game);
    }

    const event: GameOverEvent = {
      winnerId: game.state.winner!,
      reason: 'score',
    };

    for (const ws of game.clients.values()) {
      this.send(ws, { type: 'game_over', ...event });
    }

    this.debugLogger.log({
      event: 'game_over',
      gameId: game.id,
      actorPlayerId: game.state.winner!,
      stateAfter: game.state,
      detail: { ...event },
    });

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
    const client = this.clients.get(ws);
    if (client?.gameId) {
      this.debugLogger.log({
        event: 'server_error_sent',
        gameId: client.gameId,
        actorPlayerId: client.playerId,
        stateAfter: this.liveGames.get(client.gameId)?.state,
        detail: { message },
      });
    }
    this.send(ws, { type: 'error', message });
  }
}

// Start server
new GameServer(3001);

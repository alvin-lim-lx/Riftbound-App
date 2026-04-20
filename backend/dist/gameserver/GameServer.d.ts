/**
 * Game Server — WebSocket + HTTP API
 * ==================================
 * Manages live games, lobbies, matchmaking, and WebSocket broadcasting.
 */
export declare class GameServer {
    private app;
    private httpServer;
    private wss;
    private clients;
    private lobbies;
    private liveGames;
    constructor(port?: number);
    private setupRoutes;
    private setupWebSocket;
    private handleMessage;
    private startGame;
    private scheduleAIMove;
    private broadcastGameState;
    private broadcastLobby;
    private endGame;
    /**
     * Remove hidden card information for opponent privacy
     */
    private sanitizeState;
    private send;
    private sendError;
}
//# sourceMappingURL=GameServer.d.ts.map
# Riftbound TCG

A production-ready digital implementation of **Riftbound**, the League of Legends trading card game.

## Features

- **Complete Rules Engine** — Full enforcement of Riftbound rules (turn phases, combat, card effects)
- **PvP & AI** — Play against a friend online or vs a rules-based AI bot
- **Real-time Multiplayer** — WebSocket-powered instant game state synchronization
- **Scalable Architecture** — Modular engine, decoupled UI, server-authoritative design
- **Rules-Based AI** — Heuristic evaluation with pluggable AI interface (MCTS-ready)

## Quick Start

### Prerequisites
- Node.js 20+
- Docker (optional, for containerized setup)

### Run with Docker

```bash
cd docker
docker compose up
```

Open http://localhost:3000

### Run Development

```bash
# Terminal 1 — Backend
cd backend
npm install
npm run dev

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full system design.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, Zustand |
| Backend | Node.js, Express, TypeScript, ws (WebSocket) |
| Database | PostgreSQL, Redis |
| Container | Docker, Docker Compose |
| CI/CD | GitHub Actions |

### Key Files

- `shared/src/types.ts` — All shared TypeScript interfaces
- `shared/src/cards.ts` — 15+ official card definitions
- `backend/src/engine/GameEngine.ts` — Server-authoritative rules engine
- `backend/src/gameserver/GameServer.ts` — HTTP + WebSocket game server
- `backend/src/ai/RulesBasedAI.ts` — AI decision engine
- `frontend/src/components/Game/GamePage.tsx` — Main game UI

## API

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cards` | List all cards |
| GET | `/api/cards/:id` | Get card details |
| POST | `/api/lobbies` | Create lobby |
| POST | `/api/lobbies/:id/join` | Join lobby |
| POST | `/api/games/:id/action` | Submit game action |
| GET | `/api/games/:id` | Get game state |

### WebSocket Events

**Client → Server:**
- `auth` — Authenticate
- `create_lobby` / `join_lobby` / `leave_lobby`
- `submit_action` — Game action
- `pass` — Pass turn

**Server → Client:**
- `game_start` — Game begins
- `game_state_update` — State changed
- `action_result` — Action resolved
- `game_over` — Winner declared

## Game Rules

See the [official Riftbound Core Rules](https://riftbound.leagueoflegends.com/en-us/news/rules-and-releases/gameplay-guide-core-rules/).

### Key Mechanics

- **Objective:** First player to 8 points wins
- **Scoring:** Control a battlefield at the end of each turn to score 1 point
- **Combat:** Attack enemy units at a battlefield; surviving units claim it
- **Resources:** Spend rune (◆) to play cards; spend charges (⚡) for reactions
- **Keywords:** Ambush, Assault, Deflect, Ganking, Hidden, Hunt, Accelerate, Temporary, Legions

## License

MIT — Riftbound is a registered trademark of Riot Games, Inc. This is an unofficial fan implementation.

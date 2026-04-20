# Riftbound TCG — Implementation Plan

## Phase 1: Foundation (Days 1-2)
**Goal: Core game loop is playable**

### 1.1 Shared Types & Card Data
- [x] `shared/src/types.ts` — All TypeScript interfaces
- [x] `shared/src/cards.ts` — Card definitions (15+ cards from Unleashed set)
- [x] Database schema (`backend/src/db/schema.sql`)

### 1.2 Game Engine Core
- [x] `backend/src/engine/GameEngine.ts`
  - `createGame()` — Initialize a 2-player game
  - `executeAction()` — Route all action types
  - `advancePhase()` / `enterPhase()` — Turn/phase transitions
  - `handlePlayUnit` / `handlePlaySpell` / `handlePlayGear` / `handleMoveUnit` / `handleAttack` / `handlePass`
  - `resolveShowdown()` — Combat resolution
  - `getLegalActions()` — AI move generation
- [x] `backend/src/engine/utils.ts` — Random ID, shuffle

### 1.3 WebSocket Game Server
- [x] `backend/src/gameserver/GameServer.ts`
  - HTTP REST routes (cards, lobbies, games)
  - WebSocket connection management
  - Lobby lifecycle (create/join)
  - Game session management
  - Broadcast state to clients
  - AI scheduling with timer

### 1.4 AI Bot
- [x] `backend/src/ai/RulesBasedAI.ts`
  - `decide()` — Pick best action from legal moves
  - `scoreAction()` — Heuristic evaluation per action type
  - Legal action generation (delegates to engine)

### 1.5 Frontend Shell
- [x] React + Vite setup
- [x] `GameService` WebSocket client
- [x] Zustand game store
- [x] `App` entry with Lobby → Game routing
- [x] `LobbyPage` (create/join/AI game)
- [x] `GameBoard` layout with battlefield/hand panels
- [x] `BattlefieldPanel` with units and attack button
- [x] `HandPanel` with playable cards
- [x] `PlayerPanel`, `ActionBar`, `PhaseIndicator`
- [x] `CardModal`, `GameLog`
- [x] CSS styles

### 1.6 DevOps
- [x] `docker/Dockerfile`
- [x] `docker/docker-compose.yml`
- [x] `docker/nginx.conf`
- [x] GitHub Actions CI pipeline

---

## Phase 2: Full Rules (Days 3-5)
**Goal: Complete rules coverage**

### 2.1 Complete Keyword System
- [ ] Implement all keywords:
  - [ ] `Ambush` — Can be played as reaction to battlefield with units
  - [ ] `Deflect` — Opponents must pay A to target with spell/ability
  - [ ] `Hidden` — Hide now for A, react later for 0
  - [ ] `Hunt N` — Gain N XP when conquering/holding
  - [ ] `Accelerate` — Pay 1C to enter ready
  - [ ] `Temporary` — Kill at start of Beginning Phase
  - [ ] `Legions` — When you play a unit, trigger again for each played this turn
  - [ ] `Lifesteal`, `SpellShield`, `Quick`, `Fearsome`, `Elusive`
  - [ ] `Repeat` — Pay additional cost to repeat effect

### 2.2 Complete Spell Effects
- [ ] `Dancing Grenade` — Repeat with escalating damage
- [ ] `Lotus Trap` — Double damage
- [ ] `Right of Conquest` — Draw based on BF control
- [ ] `Upstage Comedy` — Repeat ready effect
- [ ] Copy effects (Reflection)

### 2.3 Combat Refinements
- [ ] Blocker assignment (defender chooses which units block)
- [ ] Damage order (assign damage to units)
- [ ] Assault stacking from multiple sources
- [ ] Hunt XP tracking and level-up

### 2.4 Phase Completeness
- [ ] Mulligan phase
- [ ] Showdown phase with blocker selection
- [ ] Scoring resolution at End phase
- [ ] Win condition (8 points)

---

## Phase 3: Multiplayer & Persistence (Days 6-8)
**Goal: Production-ready online play**

### 3.1 Account System
- [ ] `POST /api/auth/register`
- [ ] `POST /api/auth/login` → JWT
- [ ] Account middleware for protected routes

### 3.2 Deck Builder
- [ ] `GET/POST/PUT/DELETE /api/decks`
- [ ] Deck validation (legend + battlefield required, 2 copies max)
- [ ] Deck config UI

### 3.3 Match History
- [ ] Store match results in PostgreSQL
- [ ] `GET /api/matches`
- [ ] Match replay (from `match_actions` table)

### 3.4 Reconnection
- [ ] Store game state in Redis on each action
- [ ] Reconnect endpoint: `GET /api/games/:id/state`
- [ ] Client reconnects and receives current state

### 3.5 Matchmaking
- [ ] Public lobby browser
- [ ] Elo-based matchmaking queue
- [ ] Spectator mode

---

## Phase 4: Polish & AI (Days 9-12)
**Goal: Smart AI + great UX**

### 4.1 MCTS AI (Future)
- [ ] Monte Carlo Tree Search implementation
- [ ] Upper Confidence Bound (UCB1) for action selection
- [ ] Rollout simulation with heuristics
- [ ] Integration point: replace `RulesBasedAI.decide()`

### 4.2 Responsive UI
- [ ] Mobile layout for battlefield/hand
- [ ] Touch interactions
- [ ] Card drag-and-drop

### 4.3 Animations
- [ ] Card play animations
- [ ] Combat showdown animation
- [ ] Score animation
- [ ] Phase transition effects

### 4.4 Sound (Optional)
- [ ] Card play SFX
- [ ] Combat clash
- [ ] Victory fanfare

---

## MVP Scope

### Must Have (MVP)
- [x] Full 2-player game loop
- [x] Rules engine with all core actions
- [x] 15+ card types (Units, Spells, Gear, Battlefields, Legends)
- [x] Rules-based AI opponent
- [x] WebSocket real-time sync
- [x] Lobby system (create/join)
- [x] Clean web UI
- [x] Card detail modal
- [x] Game log

### Not MVP
- [ ] Account/auth system
- [ ] Deck builder UI
- [ ] Match history
- [ ] MCTS AI
- [ ] 3-4 player support
- [ ] Sideboard
- [ ] Ranked matchmaking
- [ ] Mobile UI
- [ ] Sound effects

---

## Project Structure

```
riftbound/
├── ARCHITECTURE.md          # This document
├── IMPLEMENTATION_PLAN.md   # Phased plan
│
├── shared/
│   └── src/
│       ├── types.ts         # All shared TypeScript types
│       └── cards.ts         # Card definitions
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── engine/
│       │   ├── GameEngine.ts   # Rules engine
│       │   └── utils.ts        # Helpers
│       ├── ai/
│       │   └── RulesBasedAI.ts # AI decision making
│       ├── gameserver/
│       │   └── GameServer.ts   # HTTP + WebSocket server
│       └── db/
│           ├── schema.sql      # PostgreSQL schema
│           └── seed.ts         # Card seeding
│
├── frontend/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── styles.css
│       ├── store/
│       │   └── gameStore.ts   # Zustand state
│       ├── services/
│       │   └── gameService.ts # WebSocket client
│       ├── components/
│       │   ├── Game/
│       │   │   ├── GamePage.tsx
│       │   │   ├── BattlefieldPanel.tsx
│       │   │   ├── HandPanel.tsx
│       │   │   ├── PlayerPanel.tsx
│       │   │   ├── ActionBar.tsx
│       │   │   ├── PhaseIndicator.tsx
│       │   │   ├── CardModal.tsx
│       │   │   └── GameLog.tsx
│       │   └── UI/
│       │       └── LobbyPage.tsx
│       ├── types/
│       │   └── riftbound.ts
│       └── utils/
│           └── helpers.ts
│
├── docker/
│   ├── Dockerfile
│   ├── Dockerfile.frontend
│   ├── docker-compose.yml
│   └── nginx.conf
│
└── .github/
    └── workflows/
        └── ci.yml
```

---

## Running the Project

### Development
```bash
# Backend
cd backend
npm install
npm run dev  # ts-node-dev on :3001

# Frontend
cd frontend
npm install
npm run dev  # Vite on :3000
```

### Docker
```bash
cd docker
docker compose up
# Frontend: http://localhost:3000
# Backend: http://localhost:3001
```

### Tests
```bash
cd backend
npm test
```

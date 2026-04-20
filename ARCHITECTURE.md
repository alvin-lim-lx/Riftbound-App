# Riftbound TCG - System Architecture

## 1. Overview

**Riftbound** is a multiplayer online trading card game (TCG) built around the official Riftbound rules.  
Players compete to control battlefields by playing units, spells, and gear, scoring points to reach 8 first.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENTS                              │
│              React Web UI (Vite + TypeScript)               │
└────────────────────────┬────────────────────────────────────┘
                         │ WebSocket / HTTP
┌────────────────────────▼────────────────────────────────────┐
│                    GAME SERVER (Node.js)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ Matchmaker│  │ Lobbies  │  │ Game Loop│  │  Rules   │     │
│  │          │  │          │  │          │  │  Engine  │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │  AI Bot  │  │  State   │  │ Event Bus│  │  WebSocket│    │
│  │          │  │ Manager  │  │          │  │  Manager │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    DATA LAYER                               │
│         PostgreSQL (cards, accounts, match history)         │
│            Redis (live game state cache, sessions)          │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Card Schema (JSON)

```json
{
  "id": "string",
  "name": "string",
  "type": "Unit | Spell | Gear | Battlefield | Legend",
  "cost": { "rune": number, "charges": number },
  "domains": ["Domain"],
  "keywords": ["Ambush", "Ganking", "Assault N", ...],
  "stats": { "might": number, "health": number },
  "abilities": [{ "trigger": "string", "effect": "string" }],
  "set": "string",
  "rarity": "Common | Rare | Epic | Legendary"
}
```

---

## 4. Game State Model

```typescript
interface GameState {
  id: string;
  phase: Phase;
  turn: number;
  activePlayerId: string;
  players: PlayerState[];
  battlefields: BattlefieldState[];
  actionLog: GameAction[];
  winner: string | null;
  scoreLimit: 8 | 11;
}

interface PlayerState {
  id: string;
  hand: CardInstance[];
  deck: CardInstance[];
  runeDeck: RuneCard[];
  discardPile: CardInstance[];
  score: number;
  xp: number;
  isReady: boolean;
  hiddenZone: CardInstance[];  // face-down cards (Hidden keyword)
  equipment: Map<CardInstance, GearCard>;
}

interface BattlefieldState {
  id: string;
  controllerId: string | null;
  units: CardInstance[];
  scoring: { playerId: string, turnStart: number } | null;
}

type Phase = 
  | 'Setup'
  | 'Mulligan'
  | 'Beginning'
  | 'First Main'
  | 'Combat'
  | 'Second Main'
  | 'End'
  | 'Showdown'
  | 'Scoring'
  | 'GameOver';
```

---

## 5. Rules Engine Design

### 5.1 Core Loop

```
turn循环:
  for each phase in [Beginning, FirstMain, Combat, SecondMain, End]:
    enterPhase(phase)
    while not phaseComplete:
      action = await playerInput() or aiDecide()
      if isLegal(action): executeAction(action)
      else: reject(action)
    exitPhase(phase)
```

### 5.2 Action Types

| Action | Validation | Effect |
|--------|-----------|--------|
| PlayUnit | enough resources, valid target BF | deploy to battlefield |
| PlaySpell | enough resources, valid target | resolve spell effect |
| EquipGear | gear in hand, unit on BF | attach gear |
| MoveUnit | unit has Ganking, from BF to BF | relocate unit |
| Attack | unit ready, valid BF | start showdown |
| Pass | always legal | advance phase |
| UseAbility | ability available, resources | trigger ability |

### 5.3 Combat Resolution (Showdown)

```
showdown(attackingUnit, defendingBF):
  1. Gather all units at target BF (both players')
  2. Each player designates blockers
  3. Apply Assault modifiers
  4. Calculate total might: sum(unit.might + modifiers)
  5. Assign damage to opposing units
  6. Process deaths (health <= 0)
  7. If attacker side has surviving units → conquer BF
  8. Check win condition
```

### 5.4 Keyword Reference

| Keyword | Effect |
|---------|--------|
| Ambush | May be played as Reaction to a BF where you have units |
| Assault N | +N might while attacking |
| Deflect | Opponents pay A to target with spell/ability |
| Ganking | Can move between battlefields |
| Hidden | Can hide now for A, react later for 0 |
| Hunt N | When conquering or holding, gain N XP |
| Accelerate | Pay 1C to enter ready |
| Temporary | Kill at start of your Beginning Phase |
| Legions | When you play a unit, trigger again for each you played this turn |

---

## 6. API Specification

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register | Register account |
| POST | /api/auth/login | Login |
| GET | /api/cards | List all cards |
| GET | /api/cards/:id | Get card details |
| GET | /api/decks | List user decks |
| POST | /api/decks | Create deck |
| PUT | /api/decks/:id | Update deck |
| DELETE | /api/decks/:id | Delete deck |
| GET | /api/matches | Match history |
| GET | /api/matches/:id | Match details |

### WebSocket Events

**Client → Server:**
- `join_lobby` `{ lobbyId }`
- `create_lobby` `{ deckId, gameMode }`
- `leave_lobby` `{}`
- `submit_action` `{ action }`
- `chat_message` `{ message }`

**Server → Client:**
- `lobby_state` `{ lobby }`
- `game_start` `{ gameState }`
- `game_state` `{ gameState }` (full state on each change)
- `action_result` `{ success, error? }`
- `game_over` `{ winnerId }`
- `opponent_joined` `{ player }`
- `chat_message` `{ from, message }`

---

## 7. Database Schema (PostgreSQL)

```sql
-- accounts
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- decks
CREATE TABLE decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES accounts(id),
  name TEXT NOT NULL,
  config JSONB NOT NULL,  -- { legendId, cards: [...] }
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- cards (seeded from official data)
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  cost JSONB,
  domains TEXT[],
  keywords TEXT[],
  stats JSONB,
  abilities JSONB,
  set_name TEXT,
  rarity TEXT,
  image_url TEXT
);

-- matches
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  players JSONB NOT NULL,
  winner_id UUID,
  final_state JSONB,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ
);

-- match_actions (for replay)
CREATE TABLE match_actions (
  id SERIAL PRIMARY KEY,
  match_id UUID REFERENCES matches(id),
  player_id UUID,
  action JSONB NOT NULL,
  turn INT NOT NULL,
  phase TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 8. AI Bot Design

### 8.1 Architecture

```
RulesBasedAI
  ├── MoveGenerator      — generates all legal actions
  ├── Evaluator          — scores game states
  ├── PriorityCalculator — ranks actions by urgency
  └── StrategySelector   — picks archetype (aggro/control/balance)

Future: MCTSEngine (Monte Carlo Tree Search)
```

### 8.2 Evaluation Heuristic

```
score = 
  + 10 * player.score
  + 5  * player.xp
  + 3  * (player's BF count)
  + 2  * (player's ready units)
  + 1  * (runes in hand)
  - 5  * (opponent.score)
  - 2  * (opponent's BF count)
  - 1  * (opponent's units with high might)
```

### 8.3 Decision Priority

1. Win-conclusive actions (score this turn → 8 pts)
2. Life-preserving actions (prevent opponent from scoring)
3. Resource-efficient plays (best value per rune)
4. Board development (positioning, Ganking setup)
5. Value trades (remove enemy units cheaply)

---

## 9. Frontend Component Structure

```
App
├── LoginPage / RegisterPage
├── DashboardPage
│   ├── DeckBuilder
│   └── MatchHistory
├── LobbyPage
│   ├── CreateGameModal
│   └── JoinGameModal
└── GamePage
    ├── GameBoard
    │   ├── BattlefieldPanel (×N)
    │   ├── PlayerPanel (self)
    │   │   ├── HandCards
    │   │   ├── RuneDisplay
    │   │   └── ScoreDisplay
    │   └── OpponentPanel
    ├── ActionBar
    │   ├── [Pass Turn]
    │   ├── [Undo]
    │   └── [Settings]
    ├── CardDetailModal
    ├── TargetSelector
    └── GameLog
```

---

## 10. MVP Scope vs Future Enhancements

### MVP (This Implementation)
- 2-player match (PvP and vs AI)
- Core card set (Units, Spells, Gear, Battlefields, Legends)
- Full rules enforcement
- Real-time WebSocket sync
- Basic lobby system
- Deck builder with pre-seeded cards
- Rules-based AI bot

### Post-MVP
- 3-4 player support
- Sideboard / best-of-3 tournament mode
- Ranked matchmaking (Elo)
- MCTS AI opponent
- Card collection / crafting system
- Full account system with profiles
- Match replays
- Spectator mode
- Mobile-responsive UI polish

---

## 11. Deployment

```
GitHub Actions CI/CD:
  1. lint + typecheck (backend + frontend)
  2. unit tests (backend rules engine)
  3. integration tests (WebSocket flows)
  4. build Docker image
  5. push to container registry
  6. deploy to Railway / AWS ECS

Environments:
  - dev: local Docker Compose
  - staging: ephemeral preview deploys
  - prod: Railway auto-deploy from main
```

---

## 12. Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, Zustand |
| Backend | Node.js, TypeScript, Express |
| WebSocket | ws (raw) or Socket.IO |
| Database | PostgreSQL (primary), Redis (cache/sessions) |
| ORM | Prisma |
| AI | TypeScript rules engine + minimax search (future) |
| Container | Docker + Docker Compose |
| CI/CD | GitHub Actions |
| Hosting | Railway (primary), Vercel (frontend) |

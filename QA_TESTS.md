# Riftbound QA Test Scenarios

This document defines the QA test suite run by the agent's QA phase.
It is organized by system area and priority.

---

## 1. Backend Engine Tests (`cd backend && npm test`)

All existing Jest tests must pass. These are the core game rules tests.

### 1.1 Game Creation
| ID | Scenario | Expected |
|----|----------|----------|
| `GE-1.1` | `createGame([P1, P2], ['Alice','Bob'])` | Returns `GameState` with both players, phase=Setup, winner=null |
| `GE-1.2` | Opening hand size | Each player has exactly 5 cards in hand |
| `GE-1.3` | Rune deck size | Each player has 20 runes in runeDeck |
| `GE-1.4` | Game has 3 battlefields | `state.battlefields.length === 3` |
| `GE-1.5` | `createGame` with custom `playerDecks` | Legend and Chosen Champion placed in correct zones |
| `GE-1.6` | `createGame` with PvP=false | `state.isPvP === false` |
| `GE-1.7` | `createGame` with `scoreLimit=4` | `state.scoreLimit === 4` |

### 1.2 Phase Transitions
| ID | Scenario | Expected |
|----|----------|----------|
| `GE-2.1` | Non-active player calls `Pass` | `success: false`, error: "Not your turn." |
| `GE-2.2` | Active player calls `Pass` in FirstMain | `success: true`, phase advances |
| `GE-2.3` | Action dispatched in GameOver phase | All actions return `success: false` |
| `GE-2.4` | Phase sequence: Setup → Mulligan → Awaken → Beginning → FirstMain | Each transition produces valid state |
| `GE-2.5` | Both players pass in FirstMain | Phase advances to Combat or SecondMain |
| `GE-2.6` | Mulligan phase: both players complete | Phase advances to Awaken |

### 1.3 PlayUnit
| ID | Scenario | Expected |
|----|----------|----------|
| `GE-3.1` | Play a card not in hand | `success: false`, error: "Card not found." |
| `GE-3.2` | Play a unit on an opponent-controlled BF with no friendly units | `success: false`, error contains "battlefield" |
| `GE-3.3` | Play a unit without enough mana | `success: false`, error: "Not enough mana." |
| `GE-3.4` | Play a unit with enough mana and friendly unit on BF | `success: true`, card moves from hand to battlefield |
| `GE-3.5` | Play a unit that costs 0 mana | `success: true` when other conditions met |
| `GE-3.6` | Play a Champion unit | Goes to Champion Zone, not battlefield |

### 1.4 Combat / Showdown
| ID | Scenario | Expected |
|----|----------|----------|
| `GE-4.1` | Opponent attacks in your turn | `success: false`, "Not your turn." |
| `GE-4.2` | Attack with no units on the target BF | `success: false` |
| `GE-4.3` | Attack with units on target BF | Units resolve via `resolveShowdown`; damage applied |
| `GE-4.4` | Attacking player with exhausted units only | Only ready units can attack |
| `GE-4.5` | Showdown resolves correctly | Higher might wins; ties go to defender |
| `GE-4.6` | Unit killed when might drops to 0 | Unit moved to discard |
| `GE-4.7` | Battlefield conquered after sustained scoring | `Scoring` phase triggers → `ConquerBattlefield` side effect |

### 1.5 MoveUnit (Ganking)
| ID | Scenario | Expected |
|----|----------|----------|
| `GE-5.1` | Move a unit WITHOUT Ganking keyword | `success: false`, "Unit does not have Ganking." |
| `GE-5.2` | Move a unit WITH Ganking keyword to adjacent BF | `success: true` |
| `GE-5.3` | Move a unit to a BF with no friendly units | `success: false` |
| `GE-5.4` | Move an exhausted unit | `success: false`, "Unit is exhausted." |

### 1.6 Win Conditions
| ID | Scenario | Expected |
|----|----------|----------|
| `GE-6.1` | Player reaches scoreLimit (default 8) | `checkWinCondition` returns that player ID |
| `GE-6.2` | Neither player has reached score | `checkWinCondition` returns null |
| `GE-6.3` | Player concedes | Opponent declared winner, phase=GameOver |
| `GE-6.4` | Opponent wins by opponent conceding | Winner is the non-conceding player |
| `GE-6.5` | Score tied at limit | First to reach it wins (check documented tiebreaker) |

### 1.7 getLegalActions
| ID | Scenario | Expected |
|----|----------|----------|
| `GE-7.1` | FirstMain phase for active player | Returns `Pass`, `PlayUnit` for affordable units |
| `GE-7.2` | GameOver phase | Returns empty array |
| `GE-7.3` | Player with no cards in hand | Still returns `Pass` and other legal actions |
| `GE-7.4` | Player with full mana and cards | `PlayUnit` action includes only units they can afford |

### 1.8 Card Effects & Keywords
| ID | Scenario | Expected |
|----|----------|----------|
| `GE-8.1` | Unit with **Ambush** plays hidden | `hidden: true` in action payload |
| `GE-8.2` | Unit with **Lifesteal** deals damage | Owner gains life/score equal to damage |
| `GE-8.3` | Unit with **SpellShield** targeted by Spell | Spell effect is blocked |
| `GE-8.4` | Unit with **Recall** keyword | Target unit returns to hand |
| `GE-8.5` | Unit with **Shield** | Damage is reduced by shield amount first |
| `GE-8.6` | **Accelerate** keyword | Unit can be played outside normal action phase |
| `GE-8.7` | Hidden unit **Reacts** | Triggers ReactFromHidden action |
| `GE-8.8` | Unit with **Predict** | Draws a card before ability resolves |

### 1.9 Side Effects
| ID | Scenario | Expected |
|----|----------|----------|
| `GE-9.1` | DrawRune when runeDeck empty | No card drawn; runeDiscard shuffled into runeDeck first (if rules permit) |
| `GE-9.2` | Equipment attached to unit | Unit's attachments array includes gear instanceId |
| `GE-9.3` | Unit killed → sent to discard | Card location changes to 'discard' |

---

## 2. Deck Validation (`DeckManager.validate`)

### 2.1 Legality Rules
| ID | Scenario | Expected |
|----|----------|----------|
| `DV-1.1` | 1 Legend + 39 main deck cards + 12 runes + 8 sideboard | `isValid: true` |
| `DV-1.2` | 38 main deck cards (off by 1) | `isValid: false`, error: "Main deck must have exactly 39 cards" |
| `DV-1.3` | No Legend provided | `isValid: false`, error: "Deck must have exactly 1 Legend" |
| `DV-1.4` | 2 Legends | `isValid: false` |
| `DV-1.5` | 40 rune cards (off by 1) | `isValid: false` |
| `DV-1.6` | 9 sideboard cards (off by 1) | `isValid: false` |
| `DV-1.7` | Card ID that does not exist in CARDS | `isValid: false`, invalid card listed |
| `DV-1.8` | More than 2 copies of a card | `isValid: false`, error lists the card |
| `DV-1.9` | Chosen Champion card not type=Champion | `isValid: false` |
| `DV-1.10` | Legend card not type=Legend | `isValid: false` |

### 2.2 Domain Legality (if format is "Piltover")
| ID | Scenario | Expected |
|----|----------|----------|
| `DV-2.1` | Card domains all match legend's domain | `isValid: true` |
| `DV-2.2` | Card with invalid domain for format | `isValid: false` |
| `DV-2.3` | Colorless cards in any deck | Always allowed |

---

## 3. API Routes

Base URL: `http://localhost:3001/api`

### 3.1 Auth Routes (`POST /auth/*`)
| ID | Scenario | Expected |
|----|----------|----------|
| `API-1.1` | Register with valid credentials | 201, JWT token returned |
| `API-1.2` | Register with missing fields | 400, validation error |
| `API-1.3` | Login with correct credentials | 200, JWT token returned |
| `API-1.4` | Login with wrong password | 401, "Invalid credentials" |
| `API-1.5` | Login with non-existent user | 401 |
| `API-1.6` | Access protected route without token | 401, "No token provided" |
| `API-1.7` | Access protected route with invalid token | 401, "Invalid token" |
| `API-1.8` | Access protected route with expired token | 401, "Token expired" |

### 3.2 Deck Routes (`/decks`)
| ID | Scenario | Expected |
|----|----------|----------|
| `API-2.1` | Create deck with valid payload | 201, deck object returned |
| `API-2.2` | Create deck with invalid deck (DV-1.2) | 400, validation errors returned |
| `API-2.3` | Create deck without auth | 401 |
| `API-2.4` | List decks as authenticated user | 200, array of user's decks |
| `API-2.5` | List decks as unauthenticated | 401 |
| `API-2.6` | Get deck by ID (owner) | 200, deck object |
| `API-2.7` | Get deck by ID (not owner) | 403, "You do not have permission" |
| `API-2.8` | Get deck that doesn't exist | 404 |
| `API-2.9` | Update own deck with valid data | 200 |
| `API-2.10` | Update own deck with invalid data | 400 |
| `API-2.11` | Update another user's deck | 403 |
| `API-2.12` | Delete own deck | 200 |
| `API-2.13` | Delete another user's deck | 403 |
| `API-2.14` | `POST /decks/bulk` with valid decks array | 201, array of created decks |
| `API-2.15` | `POST /decks/validate` with valid deck | 200, `isValid: true` |
| `API-2.16` | `POST /decks/validate` with invalid deck | 200, `isValid: false`, errors listed |

### 3.3 Health & Server
| ID | Scenario | Expected |
|----|----------|----------|
| `API-3.1` | `GET /health` | 200, `{status: 'ok', games: N, lobbies: M}` |
| `API-3.2` | Server starts on configured port | Port 3001 responding |

---

## 4. AI (RulesBasedAI)

### 4.1 AI Decision Making
| ID | Scenario | Expected |
|----|----------|----------|
| `AI-1.1` | AI in Setup phase | Returns a valid `Mulligan` action |
| `AI-1.2` | AI in FirstMain with units playable | Returns a `PlayUnit` action for a legal unit |
| `AI-1.3` | AI in FirstMain with no playable units | Returns `Pass` action |
| `AI-1.4` | AI in Combat phase | Returns `Attack` action with valid attacker/target |
| `AI-1.5` | AI never returns action for opponent's turn | All actions have `playerId === aiPlayerId` |
| `AI-1.6` | AI doesn't play units it can't afford | Only suggests `PlayUnit` when mana is sufficient |
| `AI-1.7` | AI doesn't attack into SpellShield units blindly | Attack decisions are logged or deterministic |

---

## 5. Frontend

### 5.1 Build & Type Safety
| ID | Scenario | Expected |
|----|----------|----------|
| `FE-1.1` | `cd frontend && npx vite build` | Exit code 0, no TypeScript errors |
| `FE-1.2` | `cd frontend && npx tsc --noEmit` | Exit code 0, no type errors |
| `FE-1.3` | `cd backend && npm run build` | Exit code 0, all `.ts` files compile |
| `FE-1.4` | `cd backend && npx tsc --noEmit` | Exit code 0, no type errors |

### 5.2 Component Rendering
| ID | Scenario | Expected |
|----|----------|----------|
| `FE-2.1` | LobbyPage renders without crash | All buttons and deck list visible |
| `FE-2.2` | DeckBuilderPage renders | 6-step wizard elements present |
| `FE-2.3` | GamePage renders | Board layout, action bar, player panels visible |
| `FE-2.4` | LoginPage renders | Email + password fields present |
| `FE-2.5` | CardModal opens on card click | Modal displays card name, type, stats, effect |

### 5.3 Game State
| ID | Scenario | Expected |
|----|----------|----------|
| `FE-3.1` | Game state update via WebSocket | UI reflects new game state without refresh |
| `FE-3.2` | Phase change | PhaseIndicator updates to show current phase |
| `FE-3.3` | Card played | Card appears in correct zone (battlefield/hand/discard) |
| `FE-3.4` | Hand limit (10 cards) | Cards exceeding limit are not shown or are flagged |
| `FE-3.5` | Score update | PointTracker updates immediately |

---

## 6. WebSocket

### 6.1 Connection & Events
| ID | Scenario | Expected |
|----|----------|----------|
| `WS-1.1` | Connect to `ws://localhost:3001` | Connection established, no error |
| `WS-1.2` | Send `createLobby` message | Receive `lobbyCreated` event with lobbyId |
| `WS-1.3` | Send `joinLobby` with valid lobbyId | Receive `playerJoined` for other players |
| `WS-1.4` | Send `joinLobby` with invalid lobbyId | Receive `error` event |
| `WS-1.5` | Both players ready in lobby | Server sends `gameStart` event |
| `WS-1.6` | Player disconnects mid-game | Opponent receives `opponentDisconnected`, game pauses or ends |
| `WS-1.7` | Execute game action via WebSocket | Receive `actionResult` with new state |
| `WS-1.8` | Invalid action via WebSocket | Receive `error` event, state unchanged |

---

## 7. End-to-End Game Flow

### 7.1 Complete Game
| ID | Scenario | Expected |
|----|----------|----------|
| `E2E-1.1` | Full 2-player game from Setup to GameOver | Winner declared, all phases executed |
| `E2E-1.2` | AI vs AI game | Both AIs make legal moves, game terminates in a winner |
| `E2E-1.3` | Player vs AI game | Player can play all action types; AI responds |
| `E2E-1.4` | Mulligan interaction | Both players can mulligan; hands update correctly |
| `E2E-1.5` | Deck runs out of cards | Game continues or ends per rules (discard shuffle or loss) |

### 7.2 Deck Import
| ID | Scenario | Expected |
|----|----------|----------|
| `E2E-2.1` | Import valid deck string | Deck parsed correctly, all 40+ card IDs resolved |
| `E2E-2.2` | Import invalid deck string | Error shown to user, deck not saved |
| `E2E-2.3` | Import deck with unknown card | Error or warning, unknown card flagged |

---

## 8. Security

| ID | Scenario | Expected |
|----|----------|----------|
| `SEC-1.1` | SQL injection in deck name field | Handled safely; no SQL execution |
| `SEC-1.2` | XSS in player name or card text | Rendered safely (escaped) in frontend |
| `SEC-1.3` | JWT secret not hardcoded in client | Frontend never receives signing secret |
| `SEC-1.4` | CORS configured correctly | API only accepts configured origins |
| `SEC-1.5` | Rate limiting on auth endpoints | Repeated failed logins → 429 returned |
| `SEC-1.6` | WebSocket authentication | Cannot join lobby or game without valid token |

---

## 9. Run Commands

```bash
# Backend tests
cd /home/panda/riftbound/backend && npm test

# Backend typecheck
cd /home/panda/riftbound/backend && npx tsc --noEmit

# Backend build
cd /home/panda/riftbound/backend && npm run build

# Frontend typecheck
cd /home/panda/riftbound/frontend && npx tsc --noEmit

# Frontend build
cd /home/panda/riftbound/frontend && npx vite build
```

---

## 10. QA Phase Exit Criteria

The QA phase **PASSES** only if:
- `npm test` exits with code 0 (all tests pass)
- `npx tsc --noEmit` exits with code 0 for both backend and frontend
- `npm run build` exits with code 0 for both backend and frontend

The QA phase **FAILS** if:
- Any test fails
- Any TypeScript compilation error
- Any build error

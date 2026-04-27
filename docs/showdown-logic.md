# Showdown Logic

> **Status**: Phase 2 redesign — attacker-first alternating focus + chain model (not yet implemented)
> **Last updated**: 2026-04-26

---

## Overview

A Showdown is a sub-phase that interrupts the Action phase when a unit moves into an enemy-occupied battlefield. It consists of a Reaction Window followed by Combat Resolution. The phase transitions from `Showdown` back to `Action` once combat is resolved.

---

## Trigger — Only Valid Path

### `MoveUnit` Action

A Showdown is triggered when a **ready unit moves to an enemy-occupied battlefield**.

**Frontend flow:**
1. Player drags a unit card from one battlefield (or base) onto an enemy battlefield
2. `queueMoveFromDrop()` validates the move and stores a `pendingMoveAction`
3. Player clicks "Confirm Move" → `confirmPendingMove()` → `handleAction('MoveUnit', { cardInstanceIds, toBattlefieldId })`
4. `gameService.submitAction(action)` sends to backend

**Payload:**
```typescript
{
  cardInstanceIds: string[]   // unit instanceIds being moved
  toBattlefieldId: string    // destination battlefield id
}
```

**Backend validation (`handleMoveUnit`, GameEngine.ts ~line 1284):**
- Must be Action phase
- Each unit must be: owned by acting player, on a battlefield or base, ready (not exhausted)
- BF-to-BF movement requires the `Ganking` keyword
- Cannot move to opponent's base
- All units being moved share the same destination

**Showdown trigger condition:**
After the unit(s) are moved to the destination BF, the engine checks:
```typescript
const enemyUnitsAtTarget = newToBf.units.filter(id =>
  newState.allCards[id].ownerId !== action.playerId
);
if (enemyUnitsAtTarget.length > 0) {
  enterShowdown(newState, primaryUnitId, toBattlefieldId);
}
```
If the destination BF has **any enemy units**, `enterShowdown` is called.

**If the destination BF is empty:** no showdown triggers. The move succeeds normally and the unit remains ready on the new BF.

---

## Phase 1: Enter Showdown

### `enterShowdown(state, attackerId, targetBattlefieldId)` — GameEngine.ts line 724

**State changes:**
1. `newState.phase = 'Showdown'`
2. A `ShowdownState` object is created on `newState.showdown`:

```typescript
interface ShowdownState {
  battlefieldId: string;         // Which BF is contested
  attackerId: string;            // Unit instanceId that triggered the showdown
  attackerOwnerId: string;       // PlayerId who owns the attacker
  focusPlayerId: string | null;  // Player with Focus; null if contested
  defenderIds: string[];          // Enemy unit instanceIds at the BF
  reactionWindowOpen: boolean;   // true = Reaction cards may be played
  combatResolved: boolean;       // true = combat has been resolved
  winner: 'attacker' | 'defender' | 'draw' | null;
  excessDamage: number;          // Might difference (for conquest check)
}
```

**Focus assignment:**
- If the BF was **empty of enemy units** (shouldn't happen in current flow, but defensively): attacker owner gets Focus immediately
- In a contested BF: `focusPlayerId = null` (unclaimed; must be earned via Focus action)

**Defender identification:**
All units on the target BF whose `ownerId !== attackerOwnerId` become `defenderIds`.

**Log:** A `'Showdown'` log entry is pushed describing which unit entered which battlefield.

---

## Phase 2: Reaction Phase

This is the alternating-focus reaction window. It uses a **chain model** — attacker starts, then focus alternates Attacker → Defender → Attacker → ... until both players pass consecutively, then the chain resolves LIFO.

### Key Differences from Prior Design

- **No focus claim step** — attacker starts with focus automatically
- **No `lastPasser` field needed** — consecutive pass detection uses a two-player pass count
- **Chain-based, not simple LIFO** — new reactions can be added *during* chain resolution, restarting the alternating sequence
- **Focus alternates** starting with attacker, regardless of who triggered the showdown

### Key Data Structures

**`actionStack: ShowdownStackEntry[]`** — ordered list of abilities/spells to resolve:

```typescript
interface ShowdownStackEntry {
  id: string;
  sourceId: string;       // cardInstanceId that produced this entry
  ownerId: string;        // player who played/called this
  type: 'ability' | 'spell';
  effect: string;         // human-readable description
  resolves: boolean;      // whether this entry has been resolved
}
```

**`focusPlayerId: string`** — whose turn to act. Starts as attacker owner. Alternates with each pass.

**`chainOpen: boolean`** — true while the chain is still accepting reactions. Becomes false when both players pass consecutively without starting a new chain.

### Phase 2 — Full Flow

#### Entry: `enterShowdown`

After `enterShowdown`:
- `focusPlayerId = attackerOwnerId` (attacker always starts with focus)
- `chainOpen = true`
- `actionStack = []`
- `reactionWindowOpen = true`

#### Sub-phase 2.1: Initial Chain (Automatic)

When the showdown begins, the **initial chain is automatically created** by the attack:

1. The attack itself triggers the first ability on the stack — the attacker's **"When I Attack"** ability → pushed onto `actionStack`
2. The defender's **"When I Defend"** ability triggers automatically → pushed onto `actionStack`
3. Both players may now take turns playing **Reaction-speed spells or Abilities** to add to the chain
4. Players alternate until both pass consecutively
5. Stack resolves **LIFO**
6. ⚠️ **During LIFO resolution**, if any entry's execution triggers a new reaction, new entries are pushed and the chain restarts

#### Sub-phase 2.2: Attacker Has Focus (Starting a New Chain)

After the initial chain resolves:
- `focusPlayerId = attackerOwnerId`
- Attacker may start a **new chain** using **either Action-speed or Reaction-speed spells or Abilities**
- Focus flips to defender
- Defender may respond with **Reaction-speed spells or Abilities** only (chain is active)
- Players alternate until both pass consecutively
- Stack resolves **LIFO**
- ⚠️ Chain can restart during resolution

#### Sub-phase 2.3: Defender Has Focus (Starting a New Chain)

After the attacker's chain resolves:
- `focusPlayerId = defenderOwnerId`
- Defender may start a **new chain** using **either Action-speed or Reaction-speed spells or Abilities**
- Focus flips to attacker
- Attacker may respond with **Reaction-speed spells or Abilities** only (chain is active)
- Players alternate until both pass consecutively
- Stack resolves **LIFO**
- ⚠️ Chain can restart during resolution

#### Sub-phase 2.4: Alternating Continues

After each chain resolves, focus passes to the other player and they may start a new chain. This repeats back and forth until:

- Both players pass consecutively **without starting a new chain**
- `actionStack` is empty
- → `resolveCombat` fires → Phase 3 (Combat Resolution)

```
Chain 1 (auto)  → resolve LIFO
Attacker focus  → start Chain 2 → resolve LIFO
Defender focus  → start Chain 3 → resolve LIFO
Attacker focus  → start Chain 4 → resolve LIFO
...
Both pass consecutively, no new chain → combat
```

**Speed rules for starting vs joining a chain:**

| Situation | Can use |
|---|---|
| Starting a new chain (player has focus, no active chain) | Action-speed or Reaction-speed spells/Abilities |
| Joining an existing chain (chain is already building) | Reaction-speed spells/Abilities only |

### Valid Actions During Reaction Phase

| Action | Who can act | Condition | Speed available | Effect |
|---|---|---|---|---|
| `Reaction` | Focussed player | `focusPlayerId === playerId` | Starts chain: Action or Reaction; Joins chain: Reaction only | Plays Reaction card from hand to BF; pushes to `actionStack`; resets pass tracker |
| `PlaySpell` | Focussed player | `focusPlayerId === playerId` | Starts chain: Action or Reaction; Joins chain: Reaction only | Plays spell; pushes to `actionStack`; resets pass tracker |
| `UseAbility` | Focussed player | `focusPlayerId === playerId` | Starts chain: Action or Reaction; Joins chain: Reaction only | Triggers unit ability; pushes to `actionStack`; resets pass tracker |
| `Pass` | Focussed player | `focusPlayerId === playerId` | Always | Flips focus to opponent; sets pass tracker for current player |

**Participation check** (GameEngine.ts line 348):
```typescript
const isShowdownParticipant =
  action.playerId === state.showdown.attackerOwnerId ||
  state.showdown.defenderIds.some(id => state.allCards[id]?.ownerId === action.playerId);
```
A non-participant cannot act during a Showdown.

### `Reaction` / `PlaySpell` Actions

**Payload (`Reaction`):**
```typescript
{ cardInstanceId: string }
```

**Payload (`PlaySpell`):**
```typescript
{
  cardInstanceId: string,
  targetId?: string,     // optional target instanceId
  targetBattlefieldId?: string
}
```

**Checks:**
- Player has focus
- Card is in player's hand
- Player has sufficient charges (Reaction) or mana (spells)
- For spells: card type is `Spell` and has domains matching player's available runes

**Effect:**
- Deduct cost
- Move card to battlefield (Reaction) or mark as in-flight spell (PlaySpell)
- Push an entry onto `actionStack`
- Reset `passTracker = [false, false]`

### `UseAbility` Action

**Payload:**
```typescript
{ cardInstanceId: string, triggeredAbilityId: string }
```

Triggered abilities on units at the contested BF (e.g., Assault, keywords with "when attacking" clauses) are activated by the focused player and pushed to the stack.

### `Pass` Action

**Payload:** `{}` (empty)

**Checks:**
- Player has focus

**Effect logic:**
```typescript
const isAttacker = focusPlayerId === attackerOwnerId;

// Set pass flag for current player
if (isAttacker) {
  newState.showdown.passTracker[0] = true;
} else {
  newState.showdown.passTracker[1] = true;
}

// Check if both passed consecutively
if (newState.showdown.passTracker[0] && newState.showdown.passTracker[1]) {
  // Both passed — resolve the stack LIFO
  resolveActionStack(newState);
  closeReactionWindow(newState);
  newState.showdown.combatResolved = true;
  // proceed to Phase 3 (Combat Resolution)
} else {
  // Flip focus to opponent
  newState.showdown.focusPlayerId =
    focusPlayerId === attackerOwnerId ? defenderOwnerId : attackerOwnerId;
}
```

**Note on passing:**
- A player passing does NOT end the current chain — the opponent still gets a turn to play reactions
- If the passing player is the one who **started** the current chain, passing just flips focus to the opponent
- The chain only resolves when **both** players pass consecutively
- "Both pass consecutively" means: the attacker passes (or has passed in a prior turn of the same chain), and the defender then also passes, without any new entries being pushed to the stack in between

---

## Phase 3: Stack Resolution During Reaction Phase

When both players pass consecutively, the `actionStack` is drained LIFO before combat begins.

---

## Phase 4: Combat Resolution

Only runs if `state.showdown.combatResolved === false`.

**Step 1 — Close reaction window** (belt-and-suspenders):
```typescript
newState.showdown = { ...newState.showdown, reactionWindowOpen: false };
```

**Step 2 — Calculate Might**

For the attacker side:
```typescript
totalAttackerMight = calculateMight(attackerId)
// + Assault bonus if attacker has GIVE_ASSAULT effectCode
```

For the defender side:
```typescript
totalDefenderMight = defenderIds.reduce((sum, id) => sum + calculateMight(newState, id), 0);
```

**`calculateMight`** (line 1510):
```typescript
base = unit.currentStats.might ?? unit.stats.might ?? 0
// + might from gear attachments
// (Assault bonus applied at showdown time only)
```

**Step 3 — Empty BF shortcut**
If `defenderIds.length === 0`, no combat occurs. Attacker survives. `showdown.winner = null`, `combatResolved = true`.

**Step 4 — Combat damage (both sides present)**

Attacker HP check:
```typescript
attackerHp = attacker.currentStats.health ?? attacker.stats.health ?? 1
newAttackerHp = attackerHp - totalDefenderMight
if (newAttackerHp <= 0) {
  // Kill attacker — move to discard, remove from BF
} else {
  attacker.currentStats.health = newAttackerHp
  survivingAttackers = [attackerId]
}
```

Each defender HP check (same logic per defender):
```typescript
defHp = defender.currentStats.health ?? defender.stats.health ?? 1
newDefHp = defHp - totalAttackerMight
// Kill or survive accordingly
```

**Step 5 — Determine winner**

| Condition | Winner |
|---|---|
| `survivingAttackers.length > 0 && survivingDefenders.length === 0` | `attacker` |
| `survivingDefenders.length > 0 && survivingAttackers.length === 0` | `defender` |
| Any other case (both have survivors, or both dead) | `draw` |

**Step 6 — Conquest**

If attacker wins (all defenders dead):
```typescript
bf.controllerId = attackerOwnerId
bf.scoringSince = newState.turn
bf.scoringPlayerId = attackerOwnerId
// Side effect: { type: 'ConquerBattlefield', battlefieldId, playerId }
```

**Step 7 — Update ShowdownState**

```typescript
newState.showdown = {
  ...newState.showdown!,
  combatResolved: true,
  winner,         // 'attacker' | 'defender' | 'draw' | null
  excessDamage: Math.abs(totalAttackerMight - totalDefenderMight),
};
```

**Step 8 — Win condition check**

If any player's score >= `state.scoreLimit`, set phase to `'GameOver'` and clear `showdown`.

**Step 9 — Return to Action phase**

```typescript
newState.phase = 'Action'
newState.showdown = null
return { success: true, newState, sideEffects: effects }
```

---

## Data Structures

### `ShowdownState` (shared/src/types.ts line 125)

```typescript
export interface ShowdownState {
  battlefieldId: string;
  attackerId: string;
  attackerOwnerId: string;
  focusPlayerId: string;                     // attacker starts with focus; alternates
  defenderIds: string[];
  reactionWindowOpen: boolean;               // true while reaction phase is active
  combatResolved: boolean;                  // true after combat is resolved
  winner: 'attacker' | 'defender' | 'draw' | null;
  excessDamage: number;
  actionStack: ShowdownStackEntry[];         // abilities/spells to resolve LIFO
  passTracker: [boolean, boolean];           // [attackerPassed, defenderPassed]
  chainOpen: boolean;                        // true while chain is accepting reactions
}
```

### `ShowdownStackEntry` (new — lives on ShowdownState.actionStack)

```typescript
export interface ShowdownStackEntry {
  id: string;
  sourceId: string;       // cardInstanceId that produced this entry
  ownerId: string;        // player who played/called this
  type: 'ability' | 'spell';
  effect: string;         // human-readable description
  resolves: boolean;      // whether this entry has been resolved
}
```

### `Phase` enum (shared/src/types.ts line 96)

```typescript
export type Phase =
  | 'Setup' | 'Mulligan' | 'Awaken' | 'Beginning'
  | 'Channel' | 'Draw' | 'Action' | 'End'
  | 'Showdown'  // <-- Showdown is a Phase
  | 'Scoring' | 'GameOver';
```

---

## Notes

### `resolveShowdown` — Dead Code

There is a second combat resolution function `resolveShowdown()` at GameEngine.ts line 1403. It is structurally similar to `resolveCombat` but has subtle differences in damage application. It is **never called from `executeAction`** in the source. It appears to be referenced only from an older compiled `dist/gameserver/GameServer.js` which calls it directly from the GameServer layer after `executeAction` succeeds in Showdown phase. This is legacy/dead code — `resolveCombat` is the active combat resolver.

### Path B (`Attack` Action) — Removed

The `Attack` action type and `handleAttack()` function were found in the codebase but **no frontend code sends this action**. It is not a valid showdown trigger. The `handleAttack` function has been excluded from this document and should be removed from the codebase in a future cleanup pass.

### Auto-advance phases

The following phases auto-advance when the effect stack is empty: `Awaken`, `Beginning`, `Channel`, `Draw`. `Showdown` does NOT auto-advance — the reaction phase requires explicit alternating passes to resolve the stack and return to `Action` phase.

## Implementation Plan

### Gap Analysis: Current Implementation vs. Desired Flow

#### What IS implemented correctly

| Component | Status | Notes |
|---|---|---|
| `ShowdownState` type | Partial | Has `battlefieldId`, `attackerId`, `attackerOwnerId`, `focusPlayerId`, `defenderIds`, `reactionWindowOpen`, `combatResolved`, `winner`, `excessDamage` |
| `enterShowdown()` | Partial | Correctly enters `Showdown` phase, gathers `defenderIds`, sets `reactionWindowOpen = true` |
| `canClaimFocus()` / `handleFocus()` | Exists but wrong | Creates a **focus claim step** — not in the flowchart; attacker should get focus automatically |
| `handleReaction()` | Exists but wrong | Moves Reaction card to BF and returns — **no stack entry pushed**, no stack resolution |
| `handlePass()` | Exists but wrong | Immediately calls `closeReactionWindow` + `resolveCombat` — **no alternating focus, no chain model** |
| `handlePlaySpell()` | Not showdown-aware | Executes spell immediately; **no stack integration** during showdown |
| `closeReactionWindow()` | Exists | Belt-and-suspenders; may become unnecessary after redesign |
| `resolveCombat()` | Correct | Combat resolution logic is sound for Phase 3/4 |
| `handleMoveUnit()` → `enterShowdown` | Correct | Showdown triggered correctly on contested BF |
| `executeAction()` routing | Partial | Routes `Focus`, `Reaction`, `Pass`, `CloseReactionWindow` correctly; `PlaySpell` not showdown-aware |

#### What is NOT implemented at all

| Missing | Impact |
|---|---|
| `ShowdownState.actionStack` | Reactions/spells have nowhere to go during showdown |
| `ShowdownState.passTracker` | No consecutive-pass detection |
| `ShowdownState.chainOpen` | No concept of an active vs. closed chain |
| `When I Attack` ability trigger (auto on enterShowdown) | Initial chain never starts automatically |
| `When I Defend` ability trigger (auto on enterShowdown) | Initial chain never starts automatically |
| `resolveAbilities('ATTACK')` / `resolveAbilities('DEFEND')` | No "When I Attack" / "When I Defend" ability resolution |
| Action-speed spell support in showdown chains | Spells can only start chains with Action-speed; not implemented |
| Chain-restart during resolution | "React while resolving" not implemented |
| Unlimited chains (attacker/defender alternating) | Only one "window" then combat — three chains never repeat |
| `resolveActionStack()` | No LIFO drain function exists |

---

### Implementation Steps

#### Step 1 — Extend `ShowdownState` type

In `shared/src/types.ts`, add three fields to `ShowdownState`:

```typescript
export interface ShowdownState {
  // ... existing fields ...
  actionStack: ShowdownStackEntry[];          // abilities/spells to resolve LIFO
  passTracker: [boolean, boolean];            // [attackerPassed, defenderPassed]
  chainOpen: boolean;                         // true = chain accepting reactions
}
```

Add a new `ShowdownStackEntry` type alongside it:

```typescript
export interface ShowdownStackEntry {
  id: string;
  sourceId: string;       // cardInstanceId that produced this entry
  ownerId: string;        // player who played/called this
  type: 'ability' | 'spell' | 'reaction';
  effect: string;         // human-readable description
  resolves: boolean;      // whether this entry has been resolved
}
```

#### Step 2 — Update `enterShowdown`

In `GameEngine.ts`:

```typescript
export function enterShowdown(state: GameState, attackerId: string, targetBattlefieldId: string): GameState {
  const newState = deepClone(state);
  // ...
  newState.phase = 'Showdown';
  newState.showdown = {
    // ... existing fields ...
    focusPlayerId: attackerOwner,           // ← CHANGE: attacker always starts with focus (was null when contested)
    actionStack: [],                        // ← NEW
    passTracker: [false, false],            // ← NEW
    chainOpen: true,                        // ← NEW
  };

  // ← NEW: Trigger initial chain automatically
  // 1. Collect "When I Attack" abilities from the attacker
  const attackerAbilities = resolveAbilities(newState, attackerId, 'ATTACK');
  // 2. Collect "When I Defend" abilities from each defender
  for (const defId of defenderIds) {
    const defAbilities = resolveAbilities(newState, defId, 'DEFEND');
  }
  // These get pushed onto actionStack as ShowdownStackEntries

  return newState;
}
```

**Changes:**
- `focusPlayerId = attackerOwner` (not `null`) — attacker always starts with focus
- Initialize `actionStack = []`, `passTracker = [false, false]`, `chainOpen = true`
- Collect `ATTACK`/`DEFEND` trigger abilities and push as stack entries

#### Step 3 — Update `resolveAbilities` to handle ATTACK/DEFEND triggers

Add trigger handling for `'ATTACK'` and `'DEFEND'` in `resolveAbilities()` (line 1720):

```typescript
function resolveAbilities(state: GameState, cardInstanceId: string, trigger: string, ...): GameSideEffect[] {
  // ...
  const abilitiesToResolve = abilityIndex !== undefined
    ? [def.abilities[abilityIndex]].filter(Boolean)
    : def.abilities.filter(a => a.trigger === trigger);
  // ...
}
```

Then add `ATTACK` and `DEFEND` trigger handlers alongside existing handlers.

#### Step 4 — Create `pushToActionStack`

A helper to push a showdown action onto the stack:

```typescript
function pushToActionStack(
  state: GameState,
  sourceId: string,
  ownerId: string,
  type: 'ability' | 'spell' | 'reaction',
  effect: string
): GameState {
  const newState = deepClone(state);
  newState.showdown!.actionStack.push({
    id: randomId(),
    sourceId,
    ownerId,
    type,
    effect,
    resolves: false,
  });
  // Any non-pass action resets the pass tracker
  newState.showdown!.passTracker = [false, false];
  newState.showdown!.chainOpen = true;
  return newState;
}
```

#### Step 5 — Update `handleReaction`

Change to push onto `actionStack` instead of resolving immediately:

```typescript
export function handleReaction(state: GameState, action: GameAction): ActionResult {
  if (!canPlayReaction(state, action.playerId, cardInstanceId)) {
    return { success: false, error: 'Cannot play Reaction card.', action };
  }

  const newState = deepClone(state);
  const card = newState.allCards[cardInstanceId];
  const def = newState.cardDefinitions[card.cardId];
  const player = newState.players[action.playerId];

  // Pay charges
  const cost = def.cost?.charges ?? 0;
  player.charges -= cost;

  // Move to battlefield face-up
  card.location = 'battlefield';
  card.facing = 'up';
  card.owner_hidden = false;
  card.battlefieldId = state.showdown!.battlefieldId;
  const bf = newState.battlefields.find(b => b.id === state.showdown!.battlefieldId)!;
  if (!bf.units.includes(cardInstanceId)) bf.units.push(cardInstanceId);
  newState.players[action.playerId].hand = player.hand.filter(id => id !== cardInstanceId);

  // Push onto showdown action stack instead of resolving immediately
  newState = pushToActionStack(newState, cardInstanceId, action.playerId, 'reaction', `Reaction: ${def.name}`);

  newState.actionLog.push(makeLog(newState, action.playerId, 'Showdown',
    `${player.name} played Reaction: ${def.name}`));

  return { success: true, action, newState };
}
```

#### Step 6 — Update `handlePlaySpell` for showdown

During `Showdown` phase, `handlePlaySpell` should push onto `actionStack` instead of resolving immediately when a chain is open. The spell resolves during LIFO drain.

#### Step 7 — Rewrite `handlePass`

```typescript
function handlePass(state: GameState, action: GameAction): ActionResult {
  if (state.phase === 'Showdown') {
    const newState = deepClone(state);
    const { focusPlayerId, attackerOwnerId, defenderIds, passTracker } = newState.showdown!;

    const isAttacker = focusPlayerId === attackerOwnerId;

    // Set pass flag for current player
    if (isAttacker) {
      newState.showdown!.passTracker[0] = true;
    } else {
      newState.showdown!.passTracker[1] = true;
    }

    // Check if both passed consecutively
    if (newState.showdown!.passTracker[0] && newState.showdown!.passTracker[1]) {
      // Both passed — resolve action stack LIFO
      const stackResult = resolveActionStack(newState);
      if (!stackResult.success) return stackResult;
      // After stack drains, proceed to combat
      const combatResult = resolveCombat(stackResult.newState!);
      if (combatResult.success && combatResult.newState) {
        combatResult.newState.actionLog.push(action);
      }
      return combatResult;
    } else {
      // Flip focus to opponent
      newState.showdown!.focusPlayerId =
        focusPlayerId === attackerOwnerId
          ? [...defenderIds.map(id => newState.allCards[id].ownerId)][0]  // pick a defender owner
          : attackerOwnerId;
      newState.actionLog.push(makeLog(newState, action.playerId, 'Pass', `${newState.players[action.playerId].name} passed focus.`));
      return { success: true, action, newState };
    }
  }

  // Non-showdown: normal phase advance
  const newState = advancePhase(deepClone(state));
  return { success: true, action, newState };
}
```

#### Step 8 — Create `resolveActionStack`

```typescript
function resolveActionStack(state: GameState): ActionResult {
  const newState = deepClone(state);
  newState.showdown!.chainOpen = false;

  while (newState.showdown!.actionStack.length > 0) {
    const entry = newState.showdown!.actionStack.pop()!; // LIFO

    // Execute the entry's effect
    const effects = executeStackEntry(newState, entry);
    // ⚠️ If executeStackEntry triggers a new reaction (e.g., unit death → deathrattle),
    // new entries are pushed onto actionStack and chainOpen becomes true.
    // The while loop must re-evaluate — a new chain has started.

    if (newState.showdown!.chainOpen) {
      // Chain restarted during resolution — break and let players continue
      break;
    }
  }

  // If stack is fully drained and chain is closed, mark chain resolved
  if (newState.showdown!.actionStack.length === 0 && !newState.showdown!.chainOpen) {
    newState.showdown!.reactionWindowOpen = false;
  }

  return { success: true, newState };
}
```

#### Step 9 — Create `executeStackEntry`

Converts a `ShowdownStackEntry` into actual game effects — applies modifiers, deals damage, draws cards, etc. This maps `type` and `effect` to the corresponding `resolveAbilities` call or direct state mutation.

#### Step 10 — Remove or repurpose `handleFocus`

`canClaimFocus` and `handleFocus` create a focus-claim step that doesn't exist in the flowchart. Attacker starts with focus automatically. Options:
- **Deprecate**: Keep `handleFocus` but `enterShowdown` already sets `focusPlayerId` so it's unreachable
- **Remove**: Delete `canClaimFocus`, `handleFocus` and the `Focus` case in `executeAction`

#### Step 11 — Remove or repurpose `closeReactionWindow`

After redesign, `reactionWindowOpen` is managed by `resolveActionStack`. `closeReactionWindow` may become a no-op or be removed.

#### Step 12 — Handle `UseAbility` in showdown

`handleUseAbility` needs showdown-awareness: when a chain is open, pushing a triggered ability onto `actionStack` rather than executing immediately.

---

### Order of Implementation

```
1. Type changes (ShowdownState + ShowdownStackEntry)     [shared/src/types.ts]
2. pushToActionStack helper                               [GameEngine.ts]
3. resolveActionStack function                            [GameEngine.ts]
4. executeStackEntry function                             [GameEngine.ts]
5. Update resolveAbilities for ATTACK/DEFEND triggers    [GameEngine.ts]
6. Update enterShowdown (initial chain + focus)           [GameEngine.ts]
7. Update handleReaction (push to stack)                  [GameEngine.ts]
8. Update handlePlaySpell (showdown stack path)          [GameEngine.ts]
9. Update handleUseAbility (showdown stack path)          [GameEngine.ts]
10. Rewrite handlePass (alternating + passTracker)        [GameEngine.ts]
11. Remove/deprecate handleFocus + canClaimFocus          [GameEngine.ts]
12. Remove/deprecate closeReactionWindow                  [GameEngine.ts]
13. Recompile backend + verify                           [terminal]
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| `passTracker: [boolean, boolean]` over `lastPasser: string \| null` | Two booleans cleanly detect consecutive passes regardless of order (A then B, or B then A) |
| `chainOpen: boolean` | Explicit flag to track whether the chain is accepting reactions; set to `true` on any reaction, `false` when both pass |
| `actionStack.pop()` (LIFO) | Matches standard stack resolution order — last response resolves first |
| Break in `resolveActionStack` loop when `chainOpen` goes true | Allows chain to restart mid-resolution when a reaction triggers a new ability |
| Attacker always starts with `focusPlayerId = attackerOwnerId` | Flowchart is explicit: attacker starts every showdown with focus |
| `enterShowdown` triggers initial ATTACK/DEFEND chain | The attack itself is the trigger for "When I Attack" and "When I Defend" — no player action needed |

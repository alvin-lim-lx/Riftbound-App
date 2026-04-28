# Frontend Showdown Wiring Plan

## Context

The backend has a complete showdown reaction phase (LIFO action stack, alternating focus, `passTracker`, `chainOpen`). The frontend is missing the types, state, UI components, and action plumbing to connect to it.

> **Spell play & targeting is a separate scope.** See [`spell-play-targeting-plan.md`](./spell-play-targeting-plan.md). Complete that first before this plan.

---

## Step 0 — Types (shared with spell targeting plan)

**File:** `frontend/src/shared/types.ts`

**Prerequisite:** Complete `spell-play-targeting-plan.md` Step 0 first. That adds `EffectStackEntry`, `ReactionPayload`, and the new `ActionType` variants.

**Then add `ShowdownStackEntry` and `ShowdownState` (after `CardInstance`):**

```typescript
export interface ShowdownStackEntry {
  id: string;
  sourceId: string;
  ownerId: string;
  type: 'ability' | 'spell' | 'reaction';
  effect: string;
  resolves: boolean;
}

export interface ShowdownState {
  battlefieldId: string;
  attackerId: string;
  attackerOwnerId: string;
  focusPlayerId: string | null;
  defenderIds: string[];
  reactionWindowOpen: boolean;
  combatResolved: boolean;
  winner: 'attacker' | 'defender' | 'draw' | null;
  excessDamage: number;
  actionStack: ShowdownStackEntry[];
  passTracker: [boolean, boolean];
  chainOpen: boolean;
}
```

**C — Add to `GameState` interface:**

```typescript
showdown: ShowdownState | null;
effectStack: EffectStackEntry[];
```

**C — `ActionType` and `ReactionPayload` are already added by spell-play-targeting-plan.md Step 0. No action needed here.**

**D — Update `PlayerState` to match backend (add missing fields):**

```typescript
legend: string | null;
chosenChampion: string | null;
hasGoneFirst: boolean;
mulligansComplete: boolean;
```

**Verify:** `cd frontend && npx tsc --noEmit`

---

## Step 1 — Add showdown state to the game store

**File:** `frontend/src/store/gameStore.ts`

**A — Import new types:**
```typescript
import type { ..., ShowdownState } from '../shared/types';
```

**B — Add showdown-derived state fields to the store interface:**
```typescript
showdown: ShowdownState | null;
focusPlayerId: string | null;
chainOpen: boolean;
passTracker: [boolean, boolean] | null;
```

**C — Update `setGameState`:**
```typescript
setGameState: (gameState: GameState) => {
  const { playerId } = get();
  const myTurn = gameState.activePlayerId === playerId;
  set({
    gameState,
    gameId: gameState.id,
    myTurn,
    phase: gameState.phase,
    showdown: gameState.showdown ?? null,
    focusPlayerId: gameState.showdown?.focusPlayerId ?? null,
    chainOpen: gameState.showdown?.chainOpen ?? false,
    passTracker: gameState.showdown?.passTracker ?? null,
  });
},
```

**D — Add computed selectors:**
```typescript
isMyShowdownTurn: () => {
  const { myTurn, showdown } = get();
  return myTurn && showdown !== null;
},

hasShowdownFocus: () => {
  const { playerId, focusPlayerId } = get();
  return focusPlayerId === playerId;
},

canPlayReaction: () => {
  const s = get();
  return s.hasShowdownFocus() && s.chainOpen;
},

canStartChain: () => {
  const s = get();
  return s.hasShowdownFocus() && !s.chainOpen;
},
```

---

## Step 2 — BattlefieldZones: make units clickable during Showdown

**File:** `frontend/src/components/Game/zones/BattlefieldZones.tsx`

**A — Add props:**
```typescript
showdownActive?: boolean;
focusPlayerId?: string | null;
currentPlayerId?: string;
```

**B — Update canAttack:**
```typescript
const canAttack = myTurn && myUnits.some(u => u.ready) &&
  battlefield.id !== myUnits[0]?.battlefieldId &&
  !showdownActive;   // no attacking during showdown
```

**C — Update UnitChip onClick:**
```typescript
onClick={
  (isEnemy || showdownActive) && hasFocus
    ? onSelect
    : isEnemy ? onSelect : undefined
}
```

**D — Golden border for targetable enemy units during showdown:
```typescript
const borderColor = isTarget ? '#fbbf24'
  : isEnemy && showdownActive && hasFocus ? '#fbbf24'
  : isEnemy ? '#ef4444' : '#22c55e';
```

---

## Step 3 — ActionBar: show Pass during Showdown

**File:** `frontend/src/components/Game/ActionBar.tsx`

**A — Add props:**
```typescript
showdownFocusPlayerId?: string | null;
currentPlayerId?: string;
pendingSpellCardId?: string | null;
```

**B — Update showPass:**
```typescript
const hasFocus = showdownFocusPlayerId === currentPlayerId;
const isMyShowdownTurn = myTurn && phase === 'Showdown';
const isTargeting = Boolean(pendingSpellCardId);
const showPass = (myTurn && phase === 'Action') || (isMyShowdownTurn && hasFocus && !isTargeting);
```

**C — Update button text:**
```typescript
const passLabel = phase === 'Showdown' ? 'Pass Focus' : 'Pass Turn';
```

**D — Pass from BoardLayout (line 2306):
```typescript
<ActionBar
  myTurn={myTurn} phase={phase} onPass={handlePass}
  showdownFocusPlayerId={showdown?.focusPlayerId}
  currentPlayerId={playerId}
  pendingSpellCardId={pendingSpellCardId}
/>
```

---

## Step 4 — PhaseIndicator: showdown focus-aware prompts

**File:** `frontend/src/components/Game/PhaseIndicator.tsx`

```typescript
export function getTurnPrompt(
  phase: Phase,
  myTurn: boolean,
  showdownFocusPlayerId?: string | null,
  currentPlayerId?: string
): string {
  ...
  if (phase === 'Showdown') {
    if (!showdownFocusPlayerId) return myTurn ? 'Claim Focus.' : 'Opponent is claiming focus.';
    if (showdownFocusPlayerId === currentPlayerId) return 'Your focus — play a reaction or pass.';
    return 'Opponent has focus — wait.';
  }
}
```

---

## Step 5 — GameService: add submitReaction helper

**File:** `frontend/src/services/gameService.ts`

```typescript
submitReaction(cardInstanceId: string, targetId?: string, targetBattlefieldId?: string) {
  this.send({
    type: 'submit_action',
    playerId: this.playerId,
    action: {
      id: `reaction_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: 'Reaction',
      playerId: this.playerId,
      payload: { cardInstanceId, targetId, targetBattlefieldId },
      turn: 0,   // caller fills from gameState
      phase: 'Showdown',
      timestamp: Date.now(),
    },
  });
}
```

---

## Step 6 — Showdown HUD banner

**File:** `frontend/src/components/Game/BoardLayout.tsx` (new, before battlefield row)

```typescript
function ShowdownBanner({
  showdown, playerId, allCards, cardDefs
}: {
  showdown: ShowdownState,
  playerId: string,
  allCards: Record<string, CardInstance>,
  cardDefs: Record<string, CardDefinition>,
}) {
  const attackerCard = allCards[showdown.attackerId];
  const attackerDef = attackerCard ? cardDefs[attackerCard.cardId] : null;
  const hasFocus = showdown.focusPlayerId === playerId;

  return (
    <div style={{
      background: 'linear-gradient(90deg, rgba(220,38,38,0.15), rgba(249,115,22,0.15))',
      border: '1px solid rgba(249,115,22,0.4)',
      borderRadius: '8px',
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
    }}>
      <span style={{ color: '#ef4444', fontWeight: 800 }}>
        ⚔ {attackerDef?.name ?? '???'} moved to {showdown.battlefieldId}
      </span>
      <span style={{
        color: hasFocus ? '#22c55e' : '#f97316',
        fontWeight: 900,
        fontSize: '13px',
      }}>
        {hasFocus ? '★ YOUR FOCUS' : '○ OPPONENT\'S FOCUS'}
      </span>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        {showdown.chainOpen ? '⛓ Chain OPEN' : '🔒 Chain CLOSED'}
        {showdown.actionStack.length > 0 ? ` [${showdown.actionStack.length} on stack]` : ''}
      </span>
    </div>
  );
}
```

Render before battlefield row:
```typescript
{showdown && (
  <ShowdownBanner
    showdown={showdown}
    playerId={playerId}
    allCards={gameState.allCards}
    cardDefs={gameState.cardDefinitions}
  />
)}
```

---

## Step 7 — Compile and verify

```bash
cd frontend && npx tsc --noEmit
npm run build
```

---

## Step 8 — Manual test

1. Start a game (two tabs or vs AI)
2. Move a unit to a contested BF → triggers Showdown
3. Verify:
   - `⚔ SHOWDOWN` banner appears above battlefield
   - Phase bar maps Showdown to the Action step
   - Player with focus sees **"Pass Focus"** button; opponent sees nothing
   - Clicking a spell in hand when you have focus → targeting mode or cast immediately
   - Clicking a valid target → `PlaySpell` with `targetId` sent to backend
   - Backend pushes to action stack, flips focus
   - Both pass → action stack drains, combat resolves
4. Edge cases:
   - Click spell without focus → error log message
   - Play Action spell during open chain → backend rejects, error in log
   - Escape during targeting → cancels, clears pending spell

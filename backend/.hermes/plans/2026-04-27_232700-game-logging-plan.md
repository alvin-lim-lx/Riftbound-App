# Implementation Plan: Full Game Action Logging
**Date:** 2026-04-27
**Status:** Plan

---

## Context

`GameState.actionLog: GameLogEntry[]` already exists. Two types flow into it:
- `GameAction` — raw structured action (always pushed by `executeAction` after success)
- `SystemLogEntry` — human-readable message (created by `makeLog()`)

The raw action log is fine for replay/audit, but `SystemLogEntry` messages are the player's game log. Currently:
- ✅ Phase changes, turn changes, scoring, combat, showdowns, reactions, abilities are logged
- ❌ **Mulligan decisions** (keep vs. set aside) are NOT logged
- ❌ **Channel phase** auto-draws 2 runes — no log entry exists
- ❌ **Draw phase** auto-draws 1 card — no log entry exists
- ❌ **MoveUnit** — no human-readable log entry
- ❌ **HideCard** / **ReactFromHidden** — no human-readable log entry
- ❌ **EquipGear** — no human-readable log entry (raw action logged, no message)
- ❌ **Setup phase** — Legend placement, Champion placement, opening hand draw not logged

---

## Privacy Rule — Opponent Card Names Must Never Appear in Logs

**Critical principle:** A player must never learn the identity of a card in their opponent's private zones. Only the acting player's private information is revealed. **Runes are fully public** — both players can always see rune identities and rune pool state.

### Visibility Rules by Card Location

| Card Location | Own Log (self) | Opponent Log |
|---|---|---|
| Your hand | ✅ Full card name revealed | ❌ "Opponent drew N cards" (no names) |
| Opponent's hand | ❌ Never (card name secret) | — |
| Hidden zone | ✅ Reveal on ReactFromHidden | ❌ Card name hidden until revealed |
| Your rune pool (channeled runes, `location: 'rune'`) | ✅ Always public | ✅ Always public (rune names visible to both) |
| Your deck top | ✅ Card name on draw | ❌ "Opponent drew 1 card" (no name) |
| Battlefield (face-up) | ✅ Always visible | ✅ Always visible |
| Equipment (attached gear) | ✅ Visible to owner | ✅ Visible once attached |
| Legend / Champion Zone | ✅ Always visible | ✅ Always visible |

### `sanitizeLogForPlayer` — Broadcast Filter

Since the full `GameState` (including `actionLog`) is sent to both players, the filtering must happen at broadcast time in `GameServer`. The `actionLog` stored on `GameState` should contain all information (actor's private data intact). The sanitization strips secrets when constructing the per-recipient payload.

**Two options — prefer Option A (simpler):**

**Option A — Two-entry pattern (recommended)**
For each private-zone event, emit two `SystemLogEntry` objects:
- `_isSelfOnly: true` — contains full card name, playerId = actor. GameServer sends this ONLY to `log.playerId`.
- No flag — contains anonymized message ("drew 1 card"), playerId = actor. GameServer sends this to the opponent.

The `_isSelfOnly` flag is the simplest signal: `recipientId !== log.playerId && log.detail?._isSelfOnly === true` → drop entry.

**Option B — Single entry, field stripping**
A single entry with `detail._isSelfView: true` or `detail._privateCardId` is kept intact for the actor, and the GameServer strips `cardId`/`cardName`/`cardInstanceId` before sending to the opponent.

**Recommended:** Option A — two entries keeps the filtering logic trivial and never leaks private data to the wrong process.

```typescript
// In GameServer — when building per-recipient state payload:
function sanitizeActionLog(logs: SystemLogEntry[], recipientId: string): SystemLogEntry[] {
  return logs.filter(log => {
    // Drop entries flagged as self-only for anyone other than the actor
    if (log.detail?._isSelfOnly === true && log.playerId !== recipientId) {
      return false;
    }
    return true;
  });
}

// Within buildStateUpdatePayload (sanitize opponent view):
const sanitizedLogs = logs.map(log => {
  if (log.playerId === recipientId) return log;  // actor sees everything
  // Opponent view: strip card identity for private-zone events (hand, deck, hidden only — runes are public)
  const isPrivateZone = log.detail?.fromZone === 'deck'
    || log.detail?.toZone === 'hand'
    || log.detail?.fromZone === 'hidden';
  if (isPrivateZone) {
    return { ...log, message: anonymizeMessage(log.message), detail: { ...log.detail, _redacted: true } };
  }
  return log;
});
```

**Rule of thumb:** Only `hand`, `deck`, and `hidden` are private zones. Rune pool (`location: 'rune'`) is always fully visible to both players. There is no rune discard step — runes persist until spent via `UseRune`.

---

## Goal

Comprehensive human-readable game log capturing all meaningful game events, grouped into categories that map cleanly to the UI.

---

## Log Entry Taxonomy

### `LogEntryType` (extend as needed)
```
'PhaseChange' | 'TurnChange' | 'Score' | 'GameStart' | 'GameOver' |
'System' | 'Showdown' | 'Combat' | 'Focus' |
'Mulligan' | 'Channel' | 'Draw' | 'RecycleRune' | 'Move' | 'Hide' | 'Equip'
```

### New `SystemLogEntry`-based log entries (human-readable, machine-parseable)

Each entry includes:
```typescript
interface SystemLogEntry {
  id: string;
  type: LogEntryType;       // e.g. 'Mulligan', 'Channel', 'Draw', 'Move'
  playerId?: string;        // who performed the action
  message: string;          // human-readable: "Panda set aside 2 cards"
  turn: number;
  phase: Phase;
  timestamp: number;
  // --- structured detail fields (key differentiator from raw GameAction) ---
  detail?: Record<string, unknown>;  // typed per action type
}
```

---

## Phase 1: Add Descriptive Log Messages to Existing Handler Gaps

### 1.1 `handleDrawRune` — add SystemLogEntry
**File:** `backend/src/engine/GameEngine.ts` ~line 1832

After `newState.actionLog.push(action)` (already present), add:

```typescript
// Runes are fully public — both players see rune names
const runeCardId = state.allCards[runeId].cardId;
const runeDef = state.cardDefinitions[runeCardId];

newState.actionLog.push(makeLog(newState, action.playerId, 'Channel',
  `${state.players[action.playerId].name} channeled ${runeDef.name}`,
  { runeCardId, runeInstanceId: runeId }
));
```

### 1.2 (Removed — `UseRune` and `runeDiscard` do not exist)
There is no `UseRune` action and no `runeDiscard` pile. Runes in the pool (`location: 'rune'`) are consumed directly during `payCardCosts`:
- **Energy cost**: runes are exhausted (`exhausted = true`) in the pool — no separate action needed
- **Power cost**: runes are recycled from pool back to `runeDeck` — no separate action needed
- No log entry needed for rune consumption during cost payment — the cost payment is implicit in the card play log entry

### 1.3 `handleMoveUnit` — add SystemLogEntry
**File:** `backend/src/engine/GameEngine.ts` ~line 1596

After state mutations, before returning:
```typescript
newState.actionLog.push(makeLog(newState, action.playerId, 'Move',
  `${playerName} moved ${unitDef.name} from ${fromBf.name} to ${toBf.name}`,
  { cardInstanceIds: moveUnitIds, fromBattlefieldId, toBattlefieldId }
));
```

### 1.4 `handleHideCard` — add SystemLogEntry
**File:** `backend/src/engine/GameEngine.ts` ~line 1866

```typescript
newState.actionLog.push(makeLog(newState, action.playerId, 'Hide',
  `${playerName} hid ${def.name}`,
  { cardInstanceId, cardId: def.id }
));
```

### 1.5 `handleReactFromHidden` — add SystemLogEntry
**File:** `backend/src/engine/GameEngine.ts` ~line 1889

```typescript
newState.actionLog.push(makeLog(newState, action.playerId, 'ReactFromHidden',
  `${playerName} revealed ${def.name} from hidden`,
  { cardInstanceId, cardId: def.id }
));
```

### 1.6 `handleEquipGear` — add SystemLogEntry
**File:** `backend/src/engine/GameEngine.ts` ~line 1588

`handleEquipGear` delegates to `handlePlayGear`. Add log after `handlePlayGear` succeeds:
```typescript
// After PlayGear side-effect is returned, append equipment-specific log
newState.actionLog.push(makeLog(newState, action.playerId, 'Equip',
  `${playerName} equipped ${def.name} to ${targetUnitDef.name}`,
  { gearInstanceId, targetUnitId }
));
```

### 1.7 `handleMulligan` — add SystemLogEntry
**File:** `backend/src/engine/GameEngine.ts` ~line 1958

After the action succeeds, add:
```typescript
newState.actionLog.push(makeLog(newState, action.playerId, 'Mulligan',
  `${playerName} completed mulligan — kept ${uniqueKeepIds.length}, set aside ${setAsideIds.length}`,
  { keptCardIds: uniqueKeepIds, setAsideCardIds: setAsideIds }
));
```

---

## Phase 2: Auto-Phase Log Entries (System-Initiated, No Player Action)

These are automatic game steps that happen without a player action object.

### 2.1 Channel Phase — log 2-rune draw
**File:** `backend/src/engine/GameEngine.ts` — `executeChannelPhase` function (needs to be located)

Current code auto-draws 2 runes with no log. Add per-rune entries — runes are fully public:

```typescript
// Both players see rune names
for (const runeId of drawnRuneIds) {
  const runeDef = state.cardDefinitions[state.allCards[runeId].cardId];
  newState.actionLog.push(makeLog(newState, playerId, 'Channel',
    `${playerName} channeled ${runeDef.name}`,
    { runeCardId: runeDef.id, runeInstanceId: runeId }
  ));
}
```

### 2.2 Draw Phase — log 1-card draw
**File:** `executeDrawPhase` function — same area

Current code auto-draws 1 card with no log. Use the two-entry pattern for hand privacy:

```typescript
// Actor sees: "Panda drew Strike from deck"
// Opponent sees: "Panda drew 1 card"
const cardDef = state.cardDefinitions[state.allCards[drawnId].cardId];

// Full name for actor
newState.actionLog.push(makeLog(newState, playerId, 'Draw',
  `${playerName} drew ${cardDef.name}`,
  { cardId: cardDef.id, cardInstanceId: drawnId, fromZone: 'deck', toZone: 'hand', _isSelfOnly: true }
));
// Anonymized for opponent
newState.actionLog.push(makeLog(newState, playerId, 'Draw',
  `${playerName} drew 1 card`,
  { count: 1, fromZone: 'deck', toZone: 'hand' }
));
```

**Note:** There is no "rune pool discard" at Draw Phase. Runes channeled during the Channel phase persist in the rune pool (`location: 'rune'`) until spent via `UseRune` (recycled to `runeDiscard`). Floating energy resets to 0, but rune pool contents are NOT discarded.

### 2.3 Setup Phase — log Legend + Champion placement + opening hand
**File:** `executeSetupPhase` ~line 555

```typescript
// Log Legend placement — always public (both players can see the Legend Zone)
newState.actionLog.push(makeLog(newState, playerId, 'System',
  `${playerName} placed ${legendDef.name} in the Legend Zone`,
  { cardId: legendDef.id, cardInstanceId: legendId, zone: 'legend' }
));

// Log Champion placement — always public (Champion Zone visible to both)
if (championId) {
  newState.actionLog.push(makeLog(newState, playerId, 'System',
    `${playerName} placed ${championDef.name} in the Champion Zone`,
    { cardId: championDef.id, cardInstanceId: championId, zone: 'championZone' }
  ));
}

// Log opening hand draw — two entries for hand privacy:
// - Actor sees: full card names
// - Opponent sees: "drew X cards" (no names)
const openingHand = newState.players[playerId].hand;
const selfMessage = `${playerName} drew opening hand (${openingHand.length} cards): ${openingHand.map(id =>
  state.cardDefinitions[newState.allCards[id].cardId]?.name ?? newState.allCards[id].cardId
).join(', ')}`;

newState.actionLog.push(makeLog(newState, playerId, 'Draw',
  selfMessage,
  { cardIds: openingHand.map(id => newState.allCards[id].cardId), count: openingHand.length, _isSelfOnly: true }
));
newState.actionLog.push(makeLog(newState, playerId, 'Draw',
  `${playerName} drew opening hand (${openingHand.length} cards)`,
  { count: openingHand.length }
));
```

### 2.4 Awaken Phase — log mana/charges reset
**File:** `executeAwakenPhase` ~line 574

```typescript
newState.actionLog.push(makeLog(newState, playerId, 'System',
  `${playerName}'s Awaken — charges reset to 1, mana reset to 2`,
  { charges: 1, mana: 2 }
));
```

---

## Phase 3: Combat & Showdown Detail Logging

### 3.1 Attack declaration — already partially logged
`handleAttack` logs showdown start at line 808. Enhance to include:
```typescript
// Already: `${attackerOwner} initiated showdown...`
// Add attacker/defender BF names and unit counts to detail
{ attackerId, targetBattlefieldId, attackerBfName, defenderBfName }
```

### 3.2 Combat resolution — log damage dealt, units killed
**File:** `resolveCombat` / `resolveShowdown` around line 1715

```typescript
// After combat resolves
newState.actionLog.push(makeLog(newState, attackerOwnerId, 'Combat',
  `Combat resolved — ${attackerName} dealt ${damageDealt} damage`,
  { attackerId, defenderIds, damageDealt, unitsKilled: killedUnitIds }
));
```

### 3.3 Blocker assignment
**File:** `handleAssignBlocker` (if it exists) or within showdown resolution

```typescript
newState.actionLog.push(makeLog(newState, defenderOwnerId, 'Combat',
  `${defenderName} assigned ${blockerName} as blocker`,
  { blockerId, attackerId }
));
```

---

## Phase 4: Ability & Effect Logging

### 4.1 Ability triggered (non-showdown)
When `resolveAbilities` fires a start-of-turn or play ability:
```typescript
newState.actionLog.push(makeLog(newState, ownerId, 'System',
  `${unitName}'s ability triggered: ${ability.effect}`,
  { cardInstanceId, abilityIndex, effect: ability.effect }
));
```

### 4.2 Equipment attached (side-effect from PlayGear)
After `AttachGear` side-effect is processed:
```typescript
// In the code that processes sideEffects after executeAction
case 'AttachGear': {
  const gear = newState.allCards[gearInstanceId];
  const unit = newState.allCards[unitInstanceId];
  newState.actionLog.push(makeLog(newState, ownerId, 'Equip',
    `${gearDef.name} equipped to ${unitDef.name}`,
    { gearInstanceId, unitInstanceId }
  ));
}
```

---

## Phase 5: `makeLog` Signature Update

Current signature:
```typescript
function makeLog(state: GameState, playerId: string, logType: LogEntryType, message: string): SystemLogEntry
```

Update to support optional `detail`:
```typescript
function makeLog(
  state: GameState,
  playerId: string,
  logType: LogEntryType,
  message: string,
  detail?: Record<string, unknown>
): SystemLogEntry
```

Add `detail?: Record<string, unknown>` to `SystemLogEntry` interface in `shared/src/types.ts`.

---

## Phase 6: `LogEntryType` Extension

Add to the `LogEntryType` union in `shared/src/types.ts`:
```typescript
export type LogEntryType =
  | 'PhaseChange' | 'TurnChange' | 'Score' | 'GameStart' | 'GameOver'
  | 'System' | 'Showdown' | 'Combat' | 'Focus'
  | 'Mulligan'        // mulligan decisions
  | 'Channel'         // rune channeled from rune deck to rune pool
  | 'Draw'            // card drawn from main deck
  | 'Move'            // unit moved between BFs or base
  | 'Hide'            // card hidden
  | 'ReactFromHidden' // card revealed from hidden
  | 'Equip';          // gear equipped to unit
```

*Note:* `RecycleRune` was removed — runes are consumed implicitly during cost payment. `runeDiscard` does not exist.

---

## Phase 7: GameServer Broadcast (Optional — for live log updates)

Currently the frontend receives `game_state_update` events. The `actionLog` is part of `GameState`, so it travels with every state update automatically. No extra WebSocket work needed.

If a separate `game_log` event is desired for incremental log appends:
```typescript
// In GameServer after executeAction succeeds:
if (result.newState) {
  const newLogEntries = result.newState.actionLog.slice(lastLogIndex);
  if (newLogEntries.length > 0) {
    server.broadcast(gameId, { type: 'game_log', entries: newLogEntries });
    lastLogIndex = result.newState.actionLog.length;
  }
}
```

**Recommendation:** Ship Phase 1–6 first. Use the existing `game_state_update` flow. Only add incremental broadcast if performance becomes an issue (large log arrays).

---

## Acceptance Criteria

1. Every action type in `ActionType` produces a human-readable `SystemLogEntry` when successful
2. Every auto-phase (Setup, Channel, Draw, Awaken) produces at least one `SystemLogEntry`
3. `SystemLogEntry.detail` is populated with structured data for all logged events
4. The `actionLog` array in `GameState` is the single source of truth — no other logging mechanism needed
5. Frontend `GameLog.tsx` component renders `SystemLogEntry.message` strings grouped by type
6. `LogEntryType` union covers all new type strings used
7. **Rune events are fully public** — rune names (channel, recycle) appear in logs for both players. Runes persist in the pool until spent — there is no rune discard step.
8. **Hand/deck privacy enforced** — opponent's private zones (hand, deck, hidden) never expose card names to the other player

---

## File Changes Summary

| File | Changes |
|---|---|
| `shared/src/types.ts` | Add `detail?` to `SystemLogEntry`, extend `LogEntryType` union |
| `backend/src/engine/GameEngine.ts` | Find `executeChannelPhase`/`executeDrawPhase`, add log calls to all handler gaps, update `makeLog` signature |
| `frontend/src/components/Game/GameLog.tsx` | Update to render new `LogEntryType` values with appropriate formatting |

---

## Implementation Order

1. **Phase 5 + 6** — Type definitions (no logic changes, lowest risk)
2. **Phase 1** — Handler gap fills (most mechanically straightforward)
3. **Phase 2** — Auto-phase logging (requires finding the auto-phase functions)
4. **Phase 3** — Combat detail
5. **Phase 4** — Ability/equipment logging
6. **Phase 7** — Only if needed after profiling

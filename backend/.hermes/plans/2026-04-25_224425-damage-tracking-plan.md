# Plan: Damage Tracking System

## Goal

Replace the current health-based combat model (where damage is subtracted from a health pool) with a **damage accumulator** model: each unit has `damage` that accumulates from combat, spells, and abilities. A unit dies when its accumulated `damage >= current might`. Damage resets to 0 after each combat resolution and at the end of each player's turn phase.

## Current Model (to replace)

```
Unit: { health: 5, damage: 0 }   # health is a static pool
On 4 damage: health = 5 - 4 = 1
On 2 more damage: health = 1 - 2 = -1 → unit dies
```

Problems with current model:
- Health is a static pool — damage doesn't persist across multiple sources
- No separation between "how much HP you have" and "how much damage you've taken"
- Engine uses `attackerHp - totalDefenderMight` which kills units in one hit
- `currentStats.health` is mutated directly, not via a damage accumulator

## New Model

```
Unit: { currentStats: { might: 5 }, damage: 0 }
Total health = current might = 5
On 4 combat damage: damage = 4 → 4 < 5 → unit lives (would have 1 HP in old model)
On 2 more spell damage: damage = 6 → 6 >= 5 → unit dies

After combat or end of turn: damage = 0 (unit resets)
```

Key properties:
- **Dynamic health**: health = `currentStats.might` — changes when buffs/debuffs modify might
- **Damage persists**: damage accumulates across multiple sources until reset
- **Death condition**: `damage >= currentStats.might` (not health - damage)
- **Reset triggers**: (1) after each combat resolves, (2) end of each player's turn phase
- **Base zone**: Each player has a `baseZone: string[]` (unit IDs) separate from battlefields. When defenders win with surviving attackers, surviving attackers are pushed to the attacker's owner's base zone. Units in base zone are still active — they can be moved back to a BF on a future turn. Units cannot enter the opponent's base zone.

## Step-by-Step Implementation

### Step 0 (MUST DO FIRST): Change `ShowdownState.attackerId` → `attackerIds: string[]`

In `shared/src/types.ts`:

```ts
export interface ShowdownState {
  battlefieldId: string;
  // attackerId: string;           // REMOVE
  attackerIds: string[];          // ADD — all attacker unit instanceIds at this BF
  attackerOwnerId: string;         // PlayerId who initiated the attack
  focusPlayerId: string | null;
  defenderIds: string[];          // Defender unit instanceIds at the BF (already array)
  reactionWindowOpen: boolean;
  combatResolved: boolean;
  winner: 'attacker' | 'defender' | 'draw' | null;
  excessDamage: number;
}
```

Also add `baseZone: string[]` to `PlayerState` — a zone for each player's retreated units that is separate from battlefields:

```ts
export interface PlayerState {
  // ...existing fields...
  baseZone: string[];  // unit instanceIds not on any BF — retreated attackers land here
}
```

Initialize `baseZone: []` in `createGame`.

This is a prerequisite for everything else. All references to `state.showdown.attackerId` must become `state.showdown.attackerIds[0]` (for backward compat in places that only need the primary attacker) or iterate over `state.showdown.attackerIds`.

### Step 1: Add `damage` field to `UnitState` in `shared/src/types.ts`

```ts
export interface UnitState {
  // ...existing fields...
  damage: number;  // accumulated damage; unit dies when damage >= current might
}
```

Find where `UnitState` is defined (search for `interface UnitState`).

Update `createGame`, `spawnUnit`, and any place a unit is instantiated to initialize `damage: 0`.

### Step 2: Add `takeDamage`, `checkUnitDeath`, `killUnit`, `resetDamage`, `pushAttackerUnitsToBaseZone` helpers in `GameEngine.ts`

```ts
/**
 * Apply damage to a unit. Damage accumulates.
 * Immediately checks for death after applying damage.
 * Returns true if the unit died as a result.
 */
function takeDamage(state: GameState, unitId: string, amount: number): boolean {
  const unit = state.allCards[unitId];
  if (!unit || unit.location === 'discard' || unit.location === 'hand') return false;
  if (amount <= 0) return false;

  unit.damage = (unit.damage || 0) + amount;

  // Immediate death check: die when accumulated damage >= current might
  return checkUnitDeath(state, unitId);
}

/**
 * Check if a unit is dead: damage >= current might.
 * If dead, move to discard and return true.
 * Returns false if unit is alive or already dead.
 */
function checkUnitDeath(state: GameState, unitId: string): boolean {
  const unit = state.allCards[unitId];
  if (!unit || unit.location === 'discard') return false;

  const totalHealth = unit.currentStats.might ?? unit.stats.might ?? 1;
  if (unit.damage >= totalHealth) {
    killUnit(state, unitId);
    return true;
  }
  return false;
}

/**
 * Kill a unit — move to discard, remove from BF, log, reset damage.
 */
function killUnit(state: GameState, unitId: string): void {
  const unit = state.allCards[unitId];
  if (!unit) return;

  unit.location = 'discard';
  unit.damage = 0;  // reset damage on death

  // Remove from all battlefield unit arrays
  for (const bf of state.battlefields) {
    bf.units = bf.units.filter(id => id !== unitId);
  }

  const ownerId = unit.ownerId;
  state.players[ownerId].discardPile.push(unitId);

  state.actionLog.push(makeLog(state, ownerId, 'System',
    `${state.cardDefinitions[unit.cardId].name} was killed.`));
}

/**
 * Reset damage for all units on all battlefields (both players).
 * Called after combat resolves and at end of turn.
 */
function resetDamage(state: GameState): void {
  for (const bf of state.battlefields) {
    for (const uid of bf.units) {
      const unit = state.allCards[uid];
      if (unit) unit.damage = 0;
    }
  }
}

/**
 * Push surviving attackers to their owner's base zone after defender wins.
 * Removes units from the contested BF and moves them to the owner's baseZone.
 * Units in base zone are active — they can be moved back to a BF on a future turn.
 * Units cannot enter the opponent's base zone.
 */
function pushAttackerUnitsToBaseZone(state: GameState, attackerIds: string[]): void {
  const contestedBf = state.battlefields.find(b =>
    b.units.some(id => attackerIds.includes(id))
  );
  for (const aid of attackerIds) {
    const unit = state.allCards[aid];
    if (!unit) continue;
    // Remove from contested BF
    if (contestedBf) contestedBf.units = contestedBf.units.filter(id => id !== aid);
    // Push to owner's base zone
    const ownerId = unit.ownerId;
    state.players[ownerId].baseZone.push(aid);
    unit.battlefieldId = null; // no longer on any BF
  }
}
```

**Key design decisions:**
- `takeDamage` calls `checkUnitDeath` immediately — death is checked at the moment damage is applied, not deferred
- Every call site that deals damage (combat, spells, abilities) uses `takeDamage` and gets immediate death feedback
- No separate "deferred death check" phase needed

### Step 3: Update `resolveCombat` in `GameEngine.ts` to use damage accumulation

In `resolveCombat()` (~line 838), replace the health-subtraction + manual kill logic with `takeDamage()` calls. Because `takeDamage` checks death immediately, there is no need for post-damage if/else branching on survival.

#### Multi-attacker + multi-defender: bidirectional ordered damage assignment

The current model is 1 attacker vs N defenders. The target model is N attackers vs N defenders, and **each side distributes their combined might across the opposing side's units in an order they choose**.

**Each side distributes their damage independently:**

- **Attacker's combined might** is distributed across defenders in the order the **attacker** chooses.
- **Defender's combined might** is distributed across attackers in the order the **defender** chooses.
- A unit can only be assigned damage if it is still alive (damage from the opposing side's prior units hasn't killed it).
- If a unit is killed, the next unit in the opposing order starts receiving damage from the remaining pool.

**Shortcut — all units on one side die:** If `totalAttackerMight >= sum of all defender mights`, all defenders die immediately — no need to choose an order. Similarly, if `totalDefenderMight >= sum of all attacker mights`, all attackers die immediately.

**Algorithm (runs once in `resolveCombat`):**

```
attackerIds = state.showdown.attackerIds   // in attacker's chosen order
defenderIds = state.showdown.defenderIds  // in defender's chosen order

totalAttackerMight = sum(calculateMight for each attacker)
totalDefenderMight = sum(calculateMight for each defender)

// --- Shortcut: overkill check ---
if totalAttackerMight >= totalDefenderMight:
    // All defenders die — order irrelevant
    for each defenderId: takeDamage(defenderId, calculateMight(defenderId))
    survivingDefenders = []
else:
    // Must distribute carefully — order matters
    // Phase 1: Attacker damage to defenders (attacker chooses order)
    remainingAttackerDamage = totalAttackerMight
    for each defenderId in attackerChosenDefenderOrder:
        if remainingAttackerDamage <= 0: break
        killThreshold = calculateMight(defenderId)
        damageToAssign = min(remainingAttackerDamage, killThreshold)
        takeDamage(defenderId, damageToAssign)
        if defender died: continue  // skip to next defender
        remainingAttackerDamage -= damageToAssign

if totalDefenderMight >= totalAttackerMight:
    // All attackers die — order irrelevant
    for each attackerId: takeDamage(attackerId, calculateMight(attackerId))
    survivingAttackers = []
else:
    // Phase 2: Defender damage to attackers (defender chooses order)
    remainingDefenderDamage = totalDefenderMight
    for each attackerId in defenderChosenAttackerOrder:
        if remainingDefenderDamage <= 0: break
        killThreshold = calculateMight(attackerId)
        damageToAssign = min(remainingDefenderDamage, killThreshold)
        takeDamage(attackerId, damageToAssign)
        if attacker died: continue  // skip to next attacker
        remainingDefenderDamage -= damageToAssign
```

This shortcut also covers the edge case where the ordering within a single-side overkill is irrelevant (all die anyway).

**Example:** Attacker has 20 might total, defenders total 12 might. All defenders die regardless of which gets targeted first.

**Who chooses order?** Both happen implicitly via the order stored in `attackerIds` and `defenderIds` — the attacker arranges `defenderIds` in their chosen attack order; the defender arranges `attackerIds` in their chosen defense order.

> **Note:** If both sides have multiple units, the Phase 1 / Phase 2 ordering is separate. Attackers can't "see" how the defender distributed damage before assigning theirs, and vice versa.

**Example:** 2 attackers [A: 5 might, B: 3 might] vs 2 defenders [C: 4 might, D: 6 might]. No Assault.

- **Attacker chooses defender order:** [D, C]
- **Defender chooses attacker order:** [A, B]

Step 1 (Attacker damage to defenders, total 8):
- D takes `min(8, 6) = 6` → 6 >= 6 → **D dies**, remaining = 2
- C takes `min(2, 4) = 2` → 2 < 4 → **C lives** with 2 damage

Step 2 (Defender damage to attackers, total 10):
- A takes `min(10, 5) = 5` → 5 >= 5 → **A dies**, remaining = 5
- B takes `min(5, 3) = 3` → 3 >= 3 → **B dies**, remaining = 2

Result: A,B,D dead; C alive with 2 damage. Defender wins (survivingDefenders > 0 and survivingAttackers === 0).

**Alternative defender order:** If defender chose [A, B]:
- A takes `min(10, 5) = 5` → 5 >= 5 → **A dies**, remaining = 5
- B takes `min(5, 3) = 3` → 3 >= 3 → **B dies**, remaining = 2

Same outcome (both dead) — but ordering can matter when only some units die.

**OLD (lines ~874-903):**
```ts
// Both sides present — resolve combat
// Attacker takes defender Might damage (single attacker, single total)
const attackerHp = attacker.currentStats.health ?? attacker.stats.health ?? 1;
const newAttackerHp = attackerHp - totalDefenderMight;
if (newAttackerHp <= 0) { kill attacker }
else { attacker.currentStats.health = newAttackerHp; survivingAttackers = [attackerId]; }

// Defenders each take attacker Might damage (no ordering — each takes full)
survivingDefenders = [];
for (const duId of defenderIds) {
  const defHp = defender.currentStats.health ?? defender.stats.health ?? 1;
  const newDefHp = defHp - totalAttackerMight;
  if (newDefHp <= 0) { kill defender }
  else { defender.currentStats.health = newDefHp; survivingDefenders.push(duId); }
}
```

**NEW:**
```ts
// Phase 1: Attacker damage to defenders — attacker chooses order
survivingDefenders = [];
let remainingAttackerDamage = totalAttackerMight;
for (const defenderId of attackerIds) {
  if (remainingAttackerDamage <= 0) break;
  const killThreshold = calculateMight(newState, defenderId);
  const damageToAssign = Math.min(remainingAttackerDamage, killThreshold);
  const died = takeDamage(newState, defenderId, damageToAssign);
  if (!died) {
    survivingDefenders.push(defenderId);
  }
  remainingAttackerDamage -= damageToAssign;
}

// Phase 2: Defender damage to attackers — defender chooses order
survivingAttackers = [];
let remainingDefenderDamage = totalDefenderMight;
for (const attackerId of defenderIds) {  // NOTE: defenderId here is a misnomer — iterating attackerIds
  if (remainingDefenderDamage <= 0) break;
  const killThreshold = calculateMight(newState, attackerId);
  const damageToAssign = Math.min(remainingDefenderDamage, killThreshold);
  const died = takeDamage(newState, attackerId, damageToAssign);
  if (!died) {
    survivingAttackers.push(attackerId);
  }
  remainingDefenderDamage -= damageToAssign;
}
```

Remove all `currentStats.health` mutations from combat — health is no longer used for death.

#### Winner determination (surviving units, not total might)

After both damage phases complete, determine winner based solely on surviving counts:

```ts
// Determine winner based on surviving units
if (survivingAttackers.length > 0 && survivingDefenders.length > 0) {
  // Both sides survived → defender wins; surviving attackers retreat to base zone
  winner = 'defender';
  pushAttackerUnitsToBaseZone(newState, survivingAttackers);

} else if (survivingAttackers.length > 0 && survivingDefenders.length === 0) {
  // All defenders wiped → attacker wins (conquest)
  winner = 'attacker';
  bf.controllerId = attackerOwnerId;
  bf.scoringSince = newState.turn;
  bf.scoringPlayerId = attackerOwnerId;

} else if (survivingAttackers.length === 0 && survivingDefenders.length > 0) {
  // All attackers killed → defender holds
  winner = 'defender';

} else {
  // 0 survivors on both sides → tie → battlefield becomes open (uncontested)
  // No controller, no scoring — nobody controls this BF
  winner = 'draw';
  bf.controllerId = null;
  bf.scoringSince = null;
  bf.scoringPlayerId = null;
}
```

> **Note:** Total might tiebreaker is **removed**. There is no might-based tiebreaker — the winner is purely based on which units are still alive. If both sides wipe, the BF goes neutral.

> **Pushback:** When defender wins with surviving attackers, those attackers are moved to the attacker's owner's **base zone** (`players[ownerId].baseZone`). Units in base zone are active — they can be moved back to a BF on a future turn. They cannot enter the opponent's base zone.

### Step 4: Add `resetDamage(state)` and call it after combat and end of turn

**After combat** — in `resolveCombat()`, after winner is determined and before returning, reset damage for ALL surviving units on ALL battlefields (both attacker's and defender's units, including any uninvolved units that may have been damaged by effects):

```ts
// Reset damage for ALL surviving units (both sides, both players)
for (const uid of [...survivingAttackers, ...survivingDefenders]) {
  newState.allCards[uid].damage = 0;
}
```

**End of turn** — in the `End` phase handler (find `executeEndPhase` or similar). Reset damage for ALL units belonging to BOTH players (not just the active player):

```ts
// In handlePass or end-of-turn logic — reset ALL units' damage, both players
for (const bf of newState.battlefields) {
  for (const uid of bf.units) {
    newState.allCards[uid].damage = 0;  // both players' units reset
  }
}
```

Also reset damage in `executeAwakenPhase` for both players' units (the "refresh" at the start of a new turn).

### Step 5: Update `handleAttack` (if it applies direct damage) and spell/effect handlers

Search for places that deal direct damage:
- `grep -n "currentStats.health" backend/src/engine/GameEngine.ts` — these may need updating
- Any effect code strings that reference damage (e.g., `"Deal 3 damage"`)

For each damage-dealing effect, replace direct health mutation with `takeDamage()` + `checkUnitDeath()`.

### Step 6: Add damage-aware effects in card abilities (if applicable)

If card ability effects deal damage (e.g., `"Deal 3 damage to target unit"`), update the effect resolver to call `takeDamage` + `checkUnitDeath` instead of mutating health.

Search: `grep -n "damage\|Deal\|Kill" backend/src/engine/GameEngine.ts | head -30`

### Step 7: Update `calculateMight` for death check

Update `checkUnitDeath` to use current might (not base stats.might) as total health:

```ts
const totalHealth = unit.currentStats.might ?? unit.stats.might ?? 1;
if ((unit.damage || 0) >= totalHealth) { killUnit(state, unitId); }
```

### Step 8: Add unit tests for damage tracking

In `backend/tests/GameEngine.test.ts`, add a new `describe('Damage Tracking')` block:

```ts
describe('Damage Tracking', () => {
  it('unit takes accumulated damage from combat and dies when damage >= might', () => {
    // Setup: 5 might unit vs 4 might defender
    // After combat: 5-might unit takes 4 damage, still alive (4 < 5)
    // 4-might defender takes 5 damage, dies (5 >= 4)
  });

  it('both sides choose order for multi-unit damage — overflow kills second unit', () => {
    // 2 attackers [A:5, B:3] vs 2 defenders [C:4, D:6], no Assault
    // Attacker orders defenders: [D, C] — D has 6 might, C has 4 might
    // Defender orders attackers: [A, B] — A has 5 might, B has 3 might
    //
    // Phase 1 (Attacker damage 8 to defenders):
    //   D takes min(8,6)=6 → 6>=6 → D dies, remaining=2
    //   C takes min(2,4)=2 → 2<4 → C lives with 2 damage
    // Phase 2 (Defender damage 10 to attackers):
    //   A takes min(10,5)=5 → 5>=5 → A dies, remaining=5
    //   B takes min(5,3)=3 → 3>=3 → B dies, remaining=2
    // Result: A,B,D dead; C alive with 2 damage. Draw → defender wins by total might (10>8).
  });

  it('damage persists across multiple damage sources before death', () => {
    // 3 damage from spell + 2 damage from combat = 5 total
    // If unit might = 5, it dies
  });

  it('damage resets to 0 after combat for surviving units', () => {
    // After combat, surviving unit's damage should be 0
  });

  it('damage resets to 0 at end of turn', () => {
    // Unit takes damage during turn, end of turn resets it
  });

  it('buffing might of a damaged unit increases its total health', () => {
    // Unit with 4 damage, 5 might (health=5) is alive
    // Buff to 6 might → now health=6, 4 damage < 6 → still alive
  });
});
```

### Step 9: Run tests

```bash
cd /home/panda/riftbound/backend
npm test  # all tests pass
```

## Files Likely to Change

|| File | Change |
|------|--------|
| `shared/src/types.ts` | Add `damage: number` to `UnitState`; change `ShowdownState.attackerId` → `attackerIds: string[]`; add `baseZone: string[]` to `PlayerState` |
| `backend/src/engine/GameEngine.ts` | Add `takeDamage`, `checkUnitDeath`, `killUnit`, `resetDamage`, `pushAttackerUnitsToBaseZone` helpers; update `resolveCombat` with bidirectional ordered damage and new winner logic; update end-of-turn; update any effect handlers dealing direct damage |
| `backend/tests/GameEngine.test.ts` | Add `describe('Damage Tracking')` with 5+ test cases |

## Key Edge Cases

1. **Might buffed after damage taken**: Unit with 4 damage, 5 might (health=5) is alive. Buff to 7 might → health=7, 4 < 7 → lives. Debuff to 3 might → health=3, 4 >= 3 → dies immediately (collateral).
2. **Might debuffed**: Unit with 3 damage, 5 might gets -2 might debuff → health becomes 3, 3 >= 3 → dies immediately.
3. **Combat damage + spell damage same turn**: Both accumulate; unit dies if total >= might. Reset at end of turn wipes all accumulated damage regardless of source.
4. **Healing**: Spell effects that "heal" reduce accumulated damage (floor at 0), not a separate health pool.
5. **Undying / reincarnate abilities**: If a unit has `damage >= might`, it goes to discard. Any on-death effects fire at that point.
6. **Both players' units reset after combat**: After combat resolves, ALL surviving units on ALL battlefields reset damage — not just the combatants, not just the active player's units.
7. **End of turn resets both players' units**: At the End phase, every unit on every BF (both players) has damage reset to 0. This is symmetrical — it benefits both players equally since the reset happens between turns.
8. **Both sides choose damage distribution order**: Attacker distributes their combined might across defenders in their chosen order; defender distributes their combined might across attackers in their chosen order. The two distributions are independent — neither side sees the other's order before choosing. Ordering matters when combined might isn't enough to kill all opposing units. Winner is determined purely by surviving unit counts — no might-based tiebreaker. If both sides wipe (0 survivors), the battlefield becomes open and uncontested.
9. **Base zone**: When defenders win with surviving attackers, those attackers move to the owner's base zone — a separate zone from BFs. Units in base zone can be moved back to any friendly BF on a future turn. Units cannot enter the opponent's base zone.

## Risks & Tradeoffs

- **Tracking `damage` on `UnitState` requires initializing it to 0** everywhere units are created — easy to miss a code path. Use grep to find all places that create units or return UnitState objects.
- **`takeDamage` is a fire-and-forget death check** — callers get a boolean back but don't need to do anything else. All death side effects (discard, BF removal, log) happen inside `killUnit`.
- **End-of-turn `resetDamage` must be placed correctly** — before scoring/end-of-turn effects that might depend on unit HP? The reset should happen at the very end of the End phase, after all other End-phase logic.
- **Buff/debuff timing on death check**: Because `takeDamage` checks death immediately after accumulating, any might debuff that follows damage will retroactively cause death if the debuff drops might below accumulated damage. Callers must be aware of this.
- **Spell/ability effects that deal damage** must use `takeDamage`, not mutate `currentStats.health` directly. Search for all `currentStats.health` mutations to find all callers that need updating.
- **No health UI changes needed** — frontend displays "currentStats.might - damage / currentStats.might" as HP.

## Verification

- All 96 existing tests pass (no regression)
- New damage tracking tests cover: combat damage, multi-source accumulation, death condition, damage reset, might-buffs-save-damaged-units

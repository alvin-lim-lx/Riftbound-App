# Plan: Add Health to Card Definitions + Improve Combat Survival

## Goal

Give Riftbound units meaningful health values so combat is not binary (live/die). A 5 Might unit vs 4 Might unit should result in the 5 Might unit surviving (possibly wounded), not both dying. The current 1-HP fallback makes combat feel random and punishes stronger units.

## Current Context

- Card definitions in `shared/src/cards.ts` define only `stats: { might: N }` — no `health` or `toughness` field.
- Combat resolution in `backend/src/engine/GameEngine.ts` (`resolveCombat`, ~line 838):
  - `attackerHp = attacker.currentStats.health ?? attacker.stats.health ?? 1` → falls back to **1 HP**
  - 5 Might attacker vs 4 Might defender → attacker takes 4 damage, dies (1-4=-3); defender takes 5 damage, dies (1-5=-4) → **draw**
- A tiebreaker fix (`363ec98`) uses Might as tiebreaker when both die, but the real fix is adding actual health values.
- No tests currently verify combat HP outcomes.

## Proposed Approach

### Option A: Add `health` to every unit card definition (preferred)
- Add `stats: { might: N, health: M }` to each unit in `shared/src/cards.ts`.
- Assign health values that make combat feel impactful (e.g., health ≈ might × 1.5–2).
- No engine changes needed — `currentStats.health ?? stats.health ?? 1` already reads it.

### Option B: Scale fallback HP by Might
- Keep 1-HP fallback but change to `Math.max(1, might - 1)` or similar.
- Cheaper to implement but less designer-controlled.

**Recommendation: Option A** — explicit designer control over unit durability.

## Step-by-Step Plan

### Step 1: Audit existing units in `shared/src/cards.ts`
- List all ~50 unit cards and their current might values.
- Assign health values. Rule of thumb: tanks (high might) also have high health; fragile units (low might) have low health.
- Health should be **≥ might** for most units so they survive at least one round of combat against equal-Might opponents.

### Step 2: Update `shared/src/cards.ts`
- For each unit entry, add `health` to `stats`:
  ```ts
  stats: { might: 5, health: 7 },
  ```
- Non-unit cards (spells, runes, gear) do not need health.

### Step 3: Verify `createGame` / `spawnUnit` / card instance creation
- Confirm `currentStats` and `stats` are copied from `cardDefinitions` at unit spawn time (already done at line 172 of `GameEngine.ts`).
- No engine changes needed.

### Step 4: Update or add combat unit tests in `backend/tests/GameEngine.test.ts`
- Add a `describe('Combat Resolution')` block with:
  - `5 Might vs 4 Might → 5 Might unit lives (takes 4 damage, has ≥5 HP)`
  - `5 Might vs 5 Might → both take 5 damage, survive with reduced HP if health ≥ 10`
  - `Empty BF (no defender) → Focus claimed, no HP lost`
  - `Conquest: attacker wins, defender wiped → attacker BF controller changes`
- Use `placeUnitAt()` helper to set up combat scenarios.

### Step 5: Run tests
- `npm test` in `backend/` — all 96+ tests pass.

### Step 6 (optional): Document combat rules in code comments
- Add JSDoc to `resolveCombat()` explaining damage calculation and winner determination.

## Files Likely to Change

| File | Change |
|------|--------|
| `shared/src/cards.ts` | Add `health: N` to all unit `stats` objects (~50 entries) |
| `backend/tests/GameEngine.test.ts` | Add `describe('Combat Resolution')` tests |

## Tests / Validation

```bash
cd /home/panda/riftbound/backend
npm test  # all tests pass
```

Specific test cases to add:
- `5 Might (HP 7) vs 4 Might (HP 5)` → attacker survives with 3 HP, defender dies
- `3 Might (HP 4) vs 3 Might (HP 4)` → both survive with 1 HP each, defender wins
- `attacker wins and BF is contested` → BF controller changes to attacker

## Risks & Tradeoffs

- **Health values are game-balance sensitive** — wrong values can make units too durable or too fragile. Start conservative (higher health = longer games).
- **Existing tests may break** if any test implicitly relied on units dying quickly. Inspect `PhaseAutoAdvance.test.ts` and `GameEngine.test.ts` after adding health.
- **No changes to engine logic needed** — the existing `currentStats.health ?? stats.health ?? 1` fallback will pick up the new values automatically.

## Open Questions

1. What health curve should units follow? (e.g., `health = Math.round(might * 1.5)` or fixed bands: Fragile/1-3, Normal/4-6, Tank/7+)
2. Should champions and legends have separate health scaling?
3. Do any cards or abilities currently reference `health` in effects? Check `abilities.effect` strings for `health`, `damage`, `heal` keywords.

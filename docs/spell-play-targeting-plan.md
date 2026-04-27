# Spell Play & Targeting — Standalone Plan

## Context

The backend handles spell resolution for both showdown (push to stack) and non-showdown (immediate via `resolveSpellEffect`) phases. `effectCode` is empty on all cards, so the frontend must infer targeting requirements from the human-readable `effect` text.

**Scope of this plan:** ALL spells — both targeted and non-targeted — go through a confirmation modal. The player selects targets (if needed), reviews the spell being cast, and confirms or cancels before the action is sent to the backend.

> **Note:** This plan does NOT include showdown UI (focus banner, pass focus, reaction chain HUD). That is covered in `showdown-frontend-wiring-plan.md` and can run in parallel once this is complete.

---

## Step 0 — Prerequisite types check

**File:** `frontend/src/shared/types.ts`

Verify these already exist (they were added in a prior session):

- `ActionType` includes `'Focus' | 'Reaction' | 'CloseReactionWindow'`
- `ReactionPayload { cardInstanceId, targetId?, targetBattlefieldId? }`
- `EffectStackEntry`

If any are missing, add them before proceeding.

---

## Step 1 — Define spell targeting rules

**File:** `frontend/src/shared/types.ts`

Spells can only target **units** (in base zone or on the battlefield) or **gear**. There is no player/base/legend targeting.

**Add `SpellTargetType`:**

```typescript
export type SpellTargetType = 'unit' | 'gear';
```

**Add `SpellTargeting` result type:**

```typescript
export interface SpellTargeting {
  needsTarget: boolean;
  targetType: SpellTargetType;
}
```

**Add `getSpellTargeting` helper** in `BoardLayout.tsx` (or a shared util file):

```typescript
function getSpellTargeting(def: CardDefinition): SpellTargeting {
  const effectText = def.abilities.map(a => `${a.effect} ${a.effectCode ?? ''}`).join(' ').toLowerCase();

  const hitsGear = effectText.includes('equip') ||
    effectText.includes('target a gear');

  const hitsUnit = effectText.includes('unit') ||
    effectText.includes('deal') ||
    effectText.includes('buff') ||
    effectText.includes('stun') ||
    effectText.includes('banish') ||
    effectText.includes('ready') ||
    effectText.includes('kill') ||
    effectText.includes('destroy');

  // Spell with no target needed (e.g. card draw, board-wide effect)
  if (!hitsUnit && !hitsGear) return { needsTarget: false, targetType: 'unit' };

  if (hitsGear && !hitsUnit) return { needsTarget: true, targetType: 'gear' };
  return { needsTarget: true, targetType: 'unit' };
}
```

> **Testing note:** Calibrate the keyword list against known spells in `shared/src/cards.ts` before wiring into the UI.

---

## Step 2 — Replace `pendingSpellCardId` with multi-select state

**File:** `frontend/src/components/Game/BoardLayout.tsx`

Replace `pendingSpellCardId: string | null` with a richer state object that tracks the card being cast and all currently-selected targets:

```typescript
interface PendingSpell {
  cardInstanceId: string;
  targetType: SpellTargetType;  // 'unit' | 'gear'
  selectedTargetIds: string[];   // instance IDs of selected targets
}

const [pendingSpell, setPendingSpell] = React.useState<PendingSpell | null>(null);
```

### 2B — Spell play eligibility check (showdown phase)

Before opening the modal, verify the player is allowed to cast this spell given the current showdown state.

```typescript
function canCastSpell(
  def: CardDefinition,
  myTurn: boolean,
  phase: Phase,
  showdown: ShowdownState | null,
  hasFocus: boolean,
): { allowed: boolean; reason?: string } {
  const hasReactionKeyword = def.keywords.includes('Reaction');
  const hasActionKeyword = def.keywords.includes('Action');
  const chainOpen = showdown?.chainOpen ?? false;

  // Non-showdown (Action phase): no action OR reaction keyword required
  // All spells (regardless of keyword) can be cast on your turn, no showdown, no chain
  if (phase !== 'Showdown') {
    if (phase === 'Action' && myTurn) return { allowed: true };
    return { allowed: false, reason: 'You can only cast spells during your turn in the Action phase.' };
  }

  // Showdown phase: action or reaction keyword required
  if (!hasFocus) return { allowed: false, reason: 'You do not have focus.' };

  if (hasReactionKeyword) {
    // Reaction: must have open chain + focus
    if (!chainOpen) return { allowed: false, reason: 'No chain is open — reaction-speed spells require an open chain.' };
  } else if (hasActionKeyword) {
    // Action: must have no open chain + focus
    if (chainOpen) return { allowed: false, reason: 'A chain is open — only reaction-speed spells can be played.' };
  } else {
    // No keyword: cannot be played during showdown at all
    return { allowed: false, reason: 'This spell cannot be played during showdown.' };
  }

  return { allowed: true };
}
```

The key fix: the chain-open checks are only evaluated inside the `phase === 'Showdown'` block, so in non-showdown phases the chain state is irrelevant.

### 2C — Update `handleSpellCardClick`

When a spell is clicked, check eligibility first. ALL spells (targeted and non-targeted) open the modal if allowed:

```typescript
const handleSpellCardClick = useCallback((cardInstanceId: string) => {
  if (!gameState) return;
  const card = gameState.allCards[cardInstanceId];
  const def = card ? gameState.cardDefinitions[card.cardId] : undefined;
  if (!card || !def) return;

  const showdown = gameState.showdown;
  const hasFocus = showdown?.focusPlayerId === playerId;
  const eligibility = canCastSpell(def, myTurn, phase, showdown, hasFocus);

  if (!eligibility.allowed) {
    store.addLog(eligibility.reason ?? 'Cannot cast this spell now.');
    return;
  }

  const targeting = getSpellTargeting(def);
  setPendingSpell({ cardInstanceId, targetType: targeting.targetType, selectedTargetIds: [] });
  store.addLog(targeting.needsTarget
    ? `Select targets for ${def.name}.`
    : `Cast ${def.name}?`
  );
}, [gameState, myTurn, phase, playerId, store]);
```

The modal's Confirm button is always enabled for non-targeted spells (since `selectedTargetIds.length === 0` is valid). For targeted spells, Confirm is disabled until at least one target is selected.

---

## Step 3 — Add targeting window component

**File:** `frontend/src/components/Game/SpellTargetingModal.tsx` (new file)

A modal overlay that shows when `pendingSpell` is active. It displays the spell card and a list of selected targets, with confirm/cancel buttons.

```tsx
interface SpellTargetingModalProps {
  pendingSpell: PendingSpell;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  onConfirm: () => void;
  onCancel: () => void;
  onRemoveTarget: (targetId: string) => void;
}

export function SpellTargetingModal({
  pendingSpell,
  allCards,
  cardDefs,
  onConfirm,
  onCancel,
  onRemoveTarget,
}: SpellTargetingModalProps) {
  const spellCard = allCards[pendingSpell.cardInstanceId];
  const spellDef = spellCard ? cardDefs[spellCard.cardId] : null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#1a1a2e',
        border: '2px solid #fbbf24',
        borderRadius: '12px',
        padding: '24px',
        minWidth: '360px',
        maxWidth: '480px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: '16px' }}>
            Cast: {spellDef?.name ?? '...'}
          </span>
          <button
            onClick={onCancel}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Spell description */}
        {spellDef && (
          <div style={{ color: '#e2e8f0', fontSize: '13px', marginBottom: '16px', lineHeight: 1.5 }}>
            {spellDef.abilities.map(a => a.effect).join(' ')}
          </div>
        )}

        {/* Selected targets list */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {pendingSpell.targetType === 'gear' ? 'Selected Gear' : 'Selected Targets'} ({pendingSpell.selectedTargetIds.length})
          </div>

          {pendingSpell.selectedTargetIds.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: '13px', fontStyle: 'italic' }}>
              {pendingSpell.targetType === 'gear'
                ? 'Click a gear card to target it'
                : 'Click units on the battlefield or in the base zone to select targets'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {pendingSpell.selectedTargetIds.map(targetId => {
                const card = allCards[targetId];
                const def = card ? cardDefs[card.cardId] : null;
                return (
                  <div key={targetId} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(251,191,36,0.1)',
                    border: '1px solid rgba(251,191,36,0.3)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                  }}>
                    <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                      {def?.name ?? targetId}
                      {card?.location && <span style={{ color: '#64748b', marginLeft: '6px' }}>({card.location})</span>}
                    </span>
                    <button
                      onClick={() => onRemoveTarget(targetId)}
                      style={{
                        background: 'rgba(239,68,68,0.2)',
                        border: '1px solid rgba(239,68,68,0.4)',
                        borderRadius: '4px',
                        color: '#f87171',
                        fontSize: '12px',
                        cursor: 'pointer',
                        padding: '2px 8px',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              background: 'transparent',
              border: '1px solid #475569',
              borderRadius: '6px',
              color: '#94a3b8',
              fontSize: '14px',
              fontWeight: 600,
              padding: '10px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pendingSpell.targetType !== 'gear' && pendingSpell.selectedTargetIds.length === 0}
            style={{
              flex: 1,
              background: pendingSpell.targetType === 'gear' || pendingSpell.selectedTargetIds.length > 0 ? '#22c55e' : '#1a3a2a',
              border: 'none',
              borderRadius: '6px',
              color: pendingSpell.targetType === 'gear' || pendingSpell.selectedTargetIds.length > 0 ? '#fff' : '#4a6a5a',
              fontSize: '14px',
              fontWeight: 700,
              padding: '10px',
              cursor: pendingSpell.targetType === 'gear' || pendingSpell.selectedTargetIds.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            {pendingSpell.targetType === 'gear'
              ? 'Cast Spell'
              : pendingSpell.selectedTargetIds.length > 0
                ? 'Confirm Target'
                : 'Cast Spell'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Step 4 — Handle confirm, remove-target, and gear-click actions

**File:** `frontend/src/components/Game/BoardLayout.tsx`

### 4A — `handleConfirmSpell`

Called when the player clicks "Confirm" in the modal. Sends the spell to the backend with the first selected target (additional targets are noted as a backend limitation):

```typescript
const handleConfirmSpell = useCallback(() => {
  if (!pendingSpell) return;
  const def = gameState?.cardDefinitions[gameState.allCards[pendingSpell.cardInstanceId]?.cardId];

  // For targeted spells: send the first selected target.
  // Multi-target spells (Bellows Breath: "up to 3 units") — only the first is processed by the backend.
  // For non-targeted spells: selectedTargetIds is empty, so targetId is omitted.
  const payload: Record<string, unknown> = { cardInstanceId: pendingSpell.cardInstanceId };
  if (pendingSpell.selectedTargetIds.length > 0) {
    payload.targetId = pendingSpell.selectedTargetIds[0];
  }

  handleAction('PlaySpell', payload);
  store.addLog(`Cast ${def?.name ?? 'spell'}.`);
  setPendingSpell(null);
}, [pendingSpell, handleAction, gameState, store]);
```

### 4B — `handleRemoveTarget`

Called when a target is removed from the modal's selection list:

```typescript
const handleRemoveTarget = useCallback((targetId: string) => {
  if (!pendingSpell) return;
  setPendingSpell({
    ...pendingSpell,
    selectedTargetIds: pendingSpell.selectedTargetIds.filter(id => id !== targetId),
  });
}, [pendingSpell]);
```

### 4C — `handleCancelSpell`

Called when the player clicks "Cancel" or ✕ in the modal:

```typescript
const handleCancelSpell = useCallback(() => {
  if (!pendingSpell) return;
  const def = gameState?.cardDefinitions[gameState.allCards[pendingSpell.cardInstanceId]?.cardId];
  store.addLog(`Cancelled casting ${def?.name ?? 'spell'}.`);
  setPendingSpell(null);
}, [pendingSpell, gameState, store]);
```

### 4D — Remove old `selectTarget`-on-click spell targeting

The previous approach (click unit → `store.selectTarget(id)` → `useEffect` fires) is replaced by the modal workflow. Revert any `onClick` on battlefield/base-zone units that called `store.selectTarget` for spell targeting.

Battlefield units clicked during `pendingSpell` should **add to** the modal's `selectedTargetIds` instead:

```typescript
const handleBattlefieldUnitClick = useCallback((unitInstanceId: string) => {
  if (!pendingSpell) return;
  if (pendingSpell.selectedTargetIds.includes(unitInstanceId)) {
    // Already selected — do nothing (removal is done in the modal)
    return;
  }
  setPendingSpell({
    ...pendingSpell,
    selectedTargetIds: [...pendingSpell.selectedTargetIds, unitInstanceId],
  });
}, [pendingSpell]);
```

> **Note:** The `store.selectTarget` mechanism is still used for move-unit targeting (different workflow). Spell targeting does NOT use it.

### 4E — `handleGearCardClick`

Gear cards can be in the base zone or attached to a unit. Both are clicked to select as a spell target:

```typescript
const handleGearCardClick = useCallback((gearInstanceId: string) => {
  if (!pendingSpell || pendingSpell.targetType !== 'gear') return;
  if (pendingSpell.selectedTargetIds.includes(gearInstanceId)) return;
  setPendingSpell({
    ...pendingSpell,
    selectedTargetIds: [...pendingSpell.selectedTargetIds, gearInstanceId],
  });
}, [pendingSpell]);
```

---

## Step 5 — Thread `pendingSpell` into BattlefieldRow

**File:** `frontend/src/components/Game/BoardLayout.tsx`

BattlefieldRow receives `pendingSpell` and its units become clickable targets (not `selectTarget`, but adding to `pendingSpell.selectedTargetIds`):

```typescript
<BattlefieldRow
  gameState={gameState}
  playerId={playerId}
  myTurn={myTurn}
  canMoveUnits={canMoveUnits}
  pendingMoveUnitIds={pendingMoveUnitIds}
  pendingMoveDestinationId={pendingMoveDestinationId}
  pendingSpell={pendingSpell}
  onBattlefieldUnitClick={handleBattlefieldUnitClick}
  onBattlefieldDrop={(cardInstanceId, battlefieldId) => queuePlayFromDrop(cardInstanceId, battlefieldId, 'battlefield')}
  onMoveDrop={queueMoveFromDrop}
  onMoveDragStart={handleMoveDragStart}
/>
```

Update `BattlefieldRowProps` and `BattlefieldRow` to accept these new props, replacing any `selectTarget`/`selectedTargetId` spell-targeting logic.

---

## Step 6 — Thread `pendingSpell` into ZoneRow

**File:** `frontend/src/components/Game/BoardLayout.tsx`

ZoneRow receives `pendingSpell` so its base-zone units AND equipment-zone gear can be selected as targets:

```typescript
<ZoneRow
  player={opponent}
  pendingSpell={pendingSpell}
  onBaseZoneUnitClick={handleBattlefieldUnitClick}
  onGearClick={handleGearCardClick}
  ...
/>
```

Add `pendingSpell` and `onGearClick` to `ZoneRowProps`. Both opponent's base-zone units and opponent's equipment-zone gear are targetable. The player's own gear is also targetable (friendly gear can be targeted by spells like "Destroy target gear").

---

## Step 7 — Render the SpellTargetingModal

**File:** `frontend/src/components/Game/BoardLayout.tsx`

When `pendingSpell` is active, render the modal:

```typescript
{pendingSpell && (
  <SpellTargetingModal
    pendingSpell={pendingSpell}
    allCards={gameState!.allCards}
    cardDefs={gameState!.cardDefinitions}
    onConfirm={handleConfirmSpell}
    onCancel={handleCancelSpell}
    onRemoveTarget={handleRemoveTarget}
  />
)}
```

Place this at the end of `BoardLayout`'s return, outside all other containers, so it overlays everything.

---

## Step 8 — Remove old targeting useEffect

**File:** `frontend/src/components/Game/BoardLayout.tsx`

The `useEffect` that watched `store.selectedTargetId` and immediately cast the spell is no longer needed for spell targeting. Remove it or confirm it is only used for move-unit targeting:

```typescript
// REMOVE or guard:
// React.useEffect(() => {
//   if (pendingSpellCardId && store.selectedTargetId) {
//     handleAction('PlaySpell', { cardInstanceId: pendingSpellCardId, targetId: store.selectedTargetId });
//     setPendingSpell(null);
//     store.selectTarget(null);
//   }
// }, [pendingSpellCardId, store.selectedTargetId]);
```

---

## Step 9 — Escape key closes the modal

```typescript
React.useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && pendingSpell) {
      handleCancelSpell();
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [pendingSpell, handleCancelSpell]);
```

---

## Step 10 — Visual feedback on battlefield/base/gear during targeting

When `pendingSpell` is active, valid targets show an amber highlight. This is decorative — clicking adds to the modal's selection, it doesn't directly cast.

**Targetability summary:**
- **Unit spells**: all battlefield units + all base-zone units (friendly and enemy) are targetable
- **Gear spells**: all gear cards (in base zone or attached to any unit) are targetable
- **Not targetable**: Legend, Champion, Base (the zone itself)

| Element | Visual cue during unit-targeting spell | Visual cue during gear-targeting spell |
|---------|--------------------------------------|--------------------------------------|
| Battlefield units (friendly and enemy) | Amber border + `cursor: crosshair` | No change |
| Base-zone units (friendly and enemy) | Amber border + `cursor: crosshair` | No change |
| Gear in base zone | No change | Amber border + `cursor: crosshair` |
| Gear attached to a unit | No change | Amber border on the gear card |
| Legend / Champion / Base (zone) | No change | No change |
| Spell card in hand | Render with pending border (e.g. amber glow) | Render with pending border |
| Everything else | `cursor: default` | `cursor: default` |

---

## Step 11 — Compile and verify

```bash
cd frontend && npx tsc --noEmit
```

Fix any type errors before proceeding.

---

## Step 12 — Manual test scenarios

| Scenario | Action | Expected |
|----------|--------|----------|
| Play non-targeted spell (Action phase) | Click spell in hand | Modal opens immediately, empty target list, Confirm enabled, log: "Cast X?" |
| Play targeted spell (Action phase) | Click spell in hand | Modal opens, empty target list, Confirm disabled until target selected |
| Click a battlefield unit | — | Unit appears in modal's target list |
| Click same unit again | — | Nothing happens (already selected; removal only via modal) |
| Click multiple units | — | All appear in modal's target list |
| Click "Remove" on a target in modal | — | Target removed from list |
| Click "Confirm" (targeted spell) | — | `PlaySpell` action sent with `targetId`, modal closes |
| Click "Confirm" (non-targeted spell) | — | `PlaySpell` action sent with no `targetId`, modal closes |
| Click "Cancel" | — | Modal closes, no action sent |
| Press Escape | — | Modal closes (cancelled) |
| Click a non-target element | — | Nothing happens |
| Try to cast spell without focus (showdown) | Click spell | Log: "You do not have focus.", modal does NOT open |
| Action-speed spell during open chain (showdown) | Click spell | Log: "A chain is open — only reaction-speed spells can be played." |
| Reaction-speed spell with no chain open (showdown) | Click spell | Log: "No chain is open — reaction-speed spells require an open chain." |
| Spell with no keyword during showdown (focus + chain open) | Click spell | Log: "This spell cannot be played during showdown." |
| Spell with no keyword during showdown (focus, no chain) | Click spell | Log: "This spell cannot be played during showdown." |
| Play gear-targeting spell | Click spell in hand | Modal opens, gear cards highlight; units do not |
| Click a gear card | — | Gear appears in modal's target list |
| Click spell card in hand while modal is open | — | Cancel current spell, open modal for newly clicked spell |

---

## Open Questions — Answered

1. **Friendly BF and base-zone units are valid spell targets** — yes, including units in your own base zone. All battlefield units and all base-zone units (friendly and enemy) are valid spell targets. Only Legend, Champion, and Base (the zone itself) are excluded.

2. **Spell play validity rules** (3 cases):
   - **No keyword**: Action phase, your turn, no showdown, no chain. Cannot be played during showdown under any circumstances.
   - **Action keyword**: Same as no keyword, plus can be played during showdown when player has focus AND there is no open chain.
   - **Reaction keyword**: Same as action keyword, plus can be played during an open chain when player has focus (in addition to action-speed conditions).
   - `canCastSpell` implements all three cases — see Step 2B for the full implementation.

3. **Gear targeting**: gear cards can be clicked whether they are in the base zone or attached to a unit as equipment. There is no separate location — gear is gear. Clicking a gear card adds it to the target list. Equipment zones (where gear attaches) are not directly clickable — only the gear card itself.

4. **Spell card in hand "stays highlighted"**: the card currently has no pending/selected style. Add a `pendingSpellCardId` string to `PendingSpell` state so the hand card can render differently when it is the pending spell:
   ```typescript
   interface PendingSpell {
     cardInstanceId: string;        // the card being cast
     targetType: SpellTargetType;
     selectedTargetIds: string[];
   }
   // The hand card with instanceId === cardInstanceId renders with a distinct border/style
   ```

---

## Blocked / Known limitations

1. **Multi-target backend** — `handlePlaySpell` / `resolveSpellEffect` only accept one `targetId`. Spells that target multiple units (e.g. Bellows Breath: "up to 3 units") will only process the first selected target. The modal allows selecting multiple, but only the first is sent. Backend fix is **out of scope**.
2. **Pre-existing build errors** in BoardLayout.tsx (duplicate `row` key) are unrelated and should not be fixed in this plan.

---

## Dependencies

- `SpellTargetingModal` (new component, Step 3)
- `PendingSpell` interface (new, Step 2)
- `canCastSpell` helper function (new, Step 2B)
- `handleGearCardClick` handler (new, Step 4E)
- `handleBattlefieldUnitClick` handler (new, Step 4D)
- `BattlefieldRow` — needs `pendingSpell` + `onBattlefieldUnitClick` props (Step 5)
- `ZoneRow` — needs `pendingSpell` + `onGearClick` props (Step 6)
- `gameStore` (`addLog`) — no longer uses `selectTarget` for spells
- `getSpellTargeting` helper (Step 1)

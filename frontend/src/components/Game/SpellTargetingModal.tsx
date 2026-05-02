import React from 'react';
import type { CardInstance, CardDefinition, SpellTargetType } from '../../shared/types';

export interface PendingSpell {
  cardInstanceId: string;
  targetType: SpellTargetType;
  selectedTargetIds: string[];
  fromHidden?: boolean;
  hiddenBattlefieldId?: string;
  needsTarget?: boolean;
}

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
  return (
    <div style={{
      position: 'fixed',
      bottom: '130px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000,
      pointerEvents: 'auto',
      width: 'min(480px, calc(100vw - 24px))',
    }}>
      <div style={{
        background: '#1a1a2e',
        border: '2px solid #fbbf24',
        borderRadius: '12px',
        padding: '16px 20px',
        width: '100%',
        maxHeight: 'calc(100dvh - 160px)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        overflowY: 'auto',
      }}>
        {/* Selected targets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {pendingSpell.needsTarget === false ? 'Ready to Cast' : pendingSpell.targetType === 'gear' ? 'Gear' : 'Targets'}
          </div>
          {pendingSpell.selectedTargetIds.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: '13px', fontStyle: 'italic' }}>
              {pendingSpell.needsTarget === false
                ? 'No target required'
                : pendingSpell.targetType === 'gear'
                ? 'Click gear to target'
                : 'Click units to target'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {pendingSpell.selectedTargetIds.map(targetId => {
                const card = allCards[targetId];
                const def = card ? cardDefs[card.cardId] : null;
                return (
                  <div key={targetId} style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'rgba(251,191,36,0.15)',
                    border: '1px solid rgba(251,191,36,0.4)',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    fontSize: '12px',
                    color: '#e2e8f0',
                  }}>
                    {def?.name ?? targetId}
                    <button
                      onClick={() => onRemoveTarget(targetId)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#f87171',
                        fontSize: '14px',
                        cursor: 'pointer',
                        padding: '0 0 0 2px',
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid #475569',
              borderRadius: '6px',
              color: '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              padding: '8px 12px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pendingSpell.needsTarget !== false && pendingSpell.targetType !== 'gear' && pendingSpell.selectedTargetIds.length === 0}
            style={{
              background: pendingSpell.needsTarget === false || pendingSpell.targetType === 'gear' || pendingSpell.selectedTargetIds.length > 0
                ? '#22c55e'
                : '#1a3a2a',
              border: 'none',
              borderRadius: '6px',
              color: pendingSpell.needsTarget === false || pendingSpell.targetType === 'gear' || pendingSpell.selectedTargetIds.length > 0
                ? '#fff'
                : '#4a6a5a',
              fontSize: '13px',
              fontWeight: 700,
              padding: '8px 14px',
              cursor: pendingSpell.needsTarget === false || pendingSpell.targetType === 'gear' || pendingSpell.selectedTargetIds.length > 0
                ? 'pointer'
                : 'not-allowed',
            }}
          >
            {pendingSpell.needsTarget === false
              ? 'Cast'
              : pendingSpell.targetType === 'gear'
              ? 'Cast'
              : pendingSpell.selectedTargetIds.length > 0
                ? 'Confirm'
                : 'Cast'}
          </button>
        </div>
      </div>
    </div>
  );
}

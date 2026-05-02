/**
 * BattlefieldPanel — displays a single battlefield with its units
 */

import React from 'react';
import type { BattlefieldState, CardInstance, CardDefinition, PlayerState } from '../../shared/types';

interface Props {
  battlefield: BattlefieldState;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  activePlayerId: string;
  currentPlayerId: string;
  myTurn: boolean;
  selectedTargetId: string | null;
  onSelectTarget: (id: string) => void;
  onAction: (type: string, payload: Record<string, unknown>) => void;
}

const BF_COLORS: Record<string, string> = {
  Baron_Pit: '#7c3aed',
  Brush: '#16a34a',
  The_Grid: '#64748b',
};

export function BattlefieldPanel({
  battlefield, allCards, cardDefs,
  activePlayerId, currentPlayerId, myTurn,
  selectedTargetId, onSelectTarget, onAction
}: Props) {
  const myUnits = battlefield.units
    .map(id => allCards[id])
    .filter(c => c && c.ownerId === currentPlayerId);

  const enemyUnits = battlefield.units
    .map(id => allCards[id])
    .filter(c => c && c.ownerId !== currentPlayerId);

  const bfColor = BF_COLORS[battlefield.cardId] ?? '#374151';
  const controlledByMe = myUnits.length > 0 && enemyUnits.length === 0;
  const controlledByEnemy = enemyUnits.length > 0 && myUnits.length === 0;
  const contested = myUnits.length > 0 && enemyUnits.length > 0;

  const styles: Record<string, React.CSSProperties> = {
    panel: {
      minWidth: '220px',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: '#ffffff',
      borderRadius: '8px',
      border: `2px solid ${
        contested
          ? 'rgba(212,168,67,0.74)'
          : controlledByMe
            ? 'rgba(34,197,94,0.72)'
            : controlledByEnemy
              ? 'rgba(239,68,68,0.72)'
              : `${bfColor}55`
      }`,
      overflow: 'hidden',
      boxShadow: contested
        ? 'inset 0 0 0 1px rgba(212,168,67,0.24), 0 0 18px rgba(212,168,67,0.12)'
        : controlledByMe
          ? 'inset 0 0 0 1px rgba(34,197,94,0.22), 0 0 18px rgba(34,197,94,0.12)'
          : controlledByEnemy
            ? 'inset 0 0 0 1px rgba(239,68,68,0.22), 0 0 18px rgba(239,68,68,0.12)'
            : '0 2px 4px rgba(0,0,0,0.06)',
    },
    header: {
      padding: '8px 12px',
      background: '#fafafa',
      borderBottom: '1px solid #e5e5e5',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    bfName: {
      fontWeight: 700,
      fontSize: '13px',
      color: '#1a1a1a',
    },
    unitArea: {
      flex: 1,
      padding: '8px',
      minHeight: '100px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    },
    unitRow: {
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
    },
    rowLabel: {
      fontSize: '10px',
      color: '#6b7280',
      textTransform: 'uppercase',
      letterSpacing: '1px',
      marginBottom: '2px',
    },
    units: {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap',
    },
    emptyState: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#9ca3af',
      fontSize: '12px',
      fontStyle: 'italic',
    },
  };

  const canAttack = myTurn && myUnits.some(u => u.ready) &&
    battlefield.id !== myUnits[0]?.battlefieldId;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.bfName}>{battlefield.name}</span>
      </div>

      <div style={styles.unitArea}>
        {battlefield.units.length === 0 ? (
          <div style={styles.emptyState}>No units</div>
        ) : (
          <>
            {enemyUnits.length > 0 && (
              <div style={styles.unitRow}>
                <div style={styles.rowLabel}>Enemy Units</div>
                <div style={styles.units}>
                  {enemyUnits.map(unit => (
                    <UnitChip
                      key={unit.instanceId}
                      unit={unit}
                      def={cardDefs[unit.cardId]}
                      isEnemy
                      isTarget={selectedTargetId === unit.instanceId}
                      onSelect={() => onSelectTarget(unit.instanceId)}
                    />
                  ))}
                </div>
              </div>
            )}
            {myUnits.length > 0 && (
              <div style={styles.unitRow}>
                <div style={styles.rowLabel}>Your Units</div>
                <div style={styles.units}>
                  {myUnits.map(unit => (
                    <UnitChip
                      key={unit.instanceId}
                      unit={unit}
                      def={cardDefs[unit.cardId]}
                      isEnemy={false}
                      isTarget={selectedTargetId === unit.instanceId}
                      onSelect={() => {}}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {canAttack && (
        <button
          style={{
            margin: '8px',
            padding: '8px 16px',
            background: '#e63946',
            border: 'none',
            borderRadius: '6px',
            color: 'white',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '12px',
            boxShadow: '0 2px 8px rgba(230,57,70,0.3)',
          }}
          onClick={() => {
            const readyUnit = myUnits.find(u => u.ready);
            if (readyUnit) {
              onAction('Attack', { attackerId: readyUnit.instanceId, targetBattlefieldId: battlefield.id });
            }
          }}
        >
          Attack This Battlefield
        </button>
      )}
    </div>
  );
}

function UnitChip({
  unit, def, isEnemy, isTarget, onSelect
}: {
  unit: CardInstance;
  def: CardDefinition | undefined;
  isEnemy: boolean;
  isTarget: boolean;
  onSelect: () => void;
}) {
  const might = unit.currentStats.might ?? unit.stats.might ?? 0;
  const health = unit.currentStats.health ?? unit.stats.health ?? 1;

  const isReady = unit.ready && !unit.exhausted;
  const borderColor = isTarget ? '#fbbf24' : isEnemy ? '#ef4444' : '#22c55e';

  const styles: Record<string, React.CSSProperties> = {
    chip: {
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '6px 10px',
      background: '#ffffff',
      border: `1px solid ${borderColor}`,
      borderRadius: '6px',
      cursor: isEnemy && !isEnemy ? 'pointer' : 'default',
      minWidth: '60px',
      opacity: isReady ? 1 : 0.6,
      boxShadow: isTarget ? `0 0 8px ${borderColor}40` : '0 1px 3px rgba(0,0,0,0.1)',
      transform: isReady ? 'scale(1)' : 'scale(0.95)',
      transition: 'all 0.15s ease',
    },
    name: {
      fontSize: '11px',
      fontWeight: 600,
      color: '#1a1a1a',
      maxWidth: '70px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      textAlign: 'center',
    },
    stats: {
      display: 'flex',
      gap: '8px',
      marginTop: '4px',
    },
    stat: {
      fontSize: '12px',
      fontWeight: 700,
    },
    might: { color: '#e63946' },
    health: { color: '#1a1a1a' },
    readyDot: {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      background: isReady ? '#22c55e' : '#9ca3af',
      marginTop: '3px',
    },
    keywordRow: {
      display: 'flex',
      gap: '2px',
      flexWrap: 'wrap',
      marginTop: '3px',
      justifyContent: 'center',
    },
    keyword: {
      fontSize: '8px',
      padding: '1px 3px',
      background: '#f3f4f6',
      borderRadius: '2px',
      color: '#6b7280',
    },
  };

  return (
    <div style={styles.chip} onClick={onSelect}>
      <span style={styles.name}>{def?.name ?? unit.cardId}</span>
      {def?.keywords && def.keywords.length > 0 && (
        <div style={styles.keywordRow}>
          {def.keywords.slice(0, 3).map(kw => (
            <span key={kw} style={styles.keyword}>{kw}</span>
          ))}
        </div>
      )}
      <div style={styles.stats}>
        <span style={{ ...styles.stat, ...styles.might }}>{might}</span>
        <span style={{ ...styles.stat, ...styles.health }}>♦{health}</span>
      </div>
      <div style={styles.readyDot} />
    </div>
  );
}

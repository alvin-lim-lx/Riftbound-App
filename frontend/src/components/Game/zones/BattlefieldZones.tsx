/**
 * BattlefieldZones — displays all battlefields in the center of the board
 */

import React from 'react';
import type { BattlefieldState, CardInstance, CardDefinition } from '../../../shared/types';

interface Props {
  battlefields: BattlefieldState[];
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

export function BattlefieldZones({
  battlefields, allCards, cardDefs,
  activePlayerId, currentPlayerId, myTurn,
  selectedTargetId, onSelectTarget, onAction
}: Props) {
  return (
    <div style={styles.container}>
      {battlefields.map(bf => (
        <BattlefieldPanel
          key={bf.id}
          battlefield={bf}
          allCards={allCards}
          cardDefs={cardDefs}
          activePlayerId={activePlayerId}
          currentPlayerId={currentPlayerId}
          myTurn={myTurn}
          selectedTargetId={selectedTargetId}
          onSelectTarget={onSelectTarget}
          onAction={onAction}
        />
      ))}
    </div>
  );
}

interface BFProps {
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

function BattlefieldPanel({
  battlefield, allCards, cardDefs,
  activePlayerId, currentPlayerId, myTurn,
  selectedTargetId, onSelectTarget, onAction
}: BFProps) {
  const myUnits = battlefield.units
    .map(id => allCards[id])
    .filter(c => c && c.ownerId === currentPlayerId);

  const enemyUnits = battlefield.units
    .map(id => allCards[id])
    .filter(c => c && c.ownerId !== currentPlayerId);

  const isControlled = battlefield.controllerId === currentPlayerId;
  const bfColor = BF_COLORS[battlefield.cardId] ?? '#374151';

  const canAttack = myTurn && myUnits.some(u => u.ready) &&
    battlefield.id !== myUnits[0]?.battlefieldId;

  return (
    <div style={{ ...styles.bfPanel, borderColor: bfColor + '55' }}>
      <div style={{ ...styles.bfHeader, background: bfColor + '22', borderBottom: `1px solid ${bfColor}44` }}>
        <span style={{ ...styles.bfName, color: bfColor }}>{battlefield.name}</span>
        <div style={styles.bfMeta}>
          {battlefield.controllerId && (
            <span style={{
              ...styles.controller,
              color: battlefield.controllerId === currentPlayerId ? '#22c55e' : '#ef4444',
            }}>
              {battlefield.controllerId === currentPlayerId ? 'You' : 'Enemy'}
            </span>
          )}
          {battlefield.scoringPlayerId && (
            <span style={styles.scoring}>● Scoring</span>
          )}
        </div>
      </div>

      <div style={styles.unitArea}>
        {battlefield.units.length === 0 ? (
          <div style={styles.emptyState}>
            {battlefield.controllerId
              ? `${battlefield.controllerId === currentPlayerId ? 'Your' : 'Enemy'} territory`
              : 'Unconquered'
            }
          </div>
        ) : (
          <>
            {enemyUnits.length > 0 && (
              <div style={styles.unitRow}>
                <div style={styles.rowLabel}>Enemy</div>
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
                <div style={styles.rowLabel}>Your</div>
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
          style={styles.attackBtn}
          onClick={() => {
            const readyUnit = myUnits.find(u => u.ready);
            if (readyUnit) {
              onAction('Attack', { attackerId: readyUnit.instanceId, targetBattlefieldId: battlefield.id });
            }
          }}
        >
          Attack
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

  return (
    <div
      style={{
        ...styles.unit,
        borderColor,
        opacity: isReady ? 1 : 0.6,
        transform: isReady ? 'scale(1)' : 'scale(0.95)',
        boxShadow: isTarget ? `0 0 10px ${borderColor}60` : '0 1px 3px rgba(0,0,0,0.2)',
        cursor: isEnemy ? 'pointer' : 'default',
      }}
      onClick={isEnemy ? onSelect : undefined}
    >
      <div style={styles.unitName}>{def?.name ?? unit.cardId}</div>
      {def?.keywords && def.keywords.length > 0 && (
        <div style={styles.keywords}>
          {def.keywords.slice(0, 2).map(kw => (
            <span key={kw} style={styles.keyword}>{kw}</span>
          ))}
        </div>
      )}
      <div style={styles.stats}>
        <span style={{ ...styles.statNum, color: '#e63946' }}>{might}</span>
        <span style={{ ...styles.statNum, color: '#e8e8e8' }}>♦{health}</span>
      </div>
      <div style={{
        ...styles.readyDot,
        background: isReady ? '#22c55e' : '#555',
      }} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    gap: '12px',
    width: '100%',
    alignItems: 'flex-start', // FIX: don't stretch children beyond their content width (fixes #36)
    overflowX: 'auto',
  },
  bfPanel: {
    minWidth: '200px',
    flex: '0 1 auto',  // shrink-only: don't grow beyond content, only shrink if needed
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.1)',
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  },
  bfHeader: {
    padding: '7px 10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bfName: {
    fontWeight: 800,
    fontSize: '13px',
  },
  bfMeta: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  controller: {
    fontSize: '11px',
    fontWeight: 700,
  },
  scoring: {
    fontSize: '10px',
    color: '#d4a843',
  },
  unitArea: {
    flex: 1,
    padding: '8px',
    minHeight: '80px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  unitRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  rowLabel: {
    fontSize: '9px',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  units: {
    display: 'flex',
    gap: '5px',
    flexWrap: 'wrap',
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#555',
    fontSize: '12px',
    fontStyle: 'italic',
  },
  unit: {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '5px 8px',
    background: 'rgba(20,20,35,0.8)',
    border: '1px solid',
    borderRadius: '6px',
    minWidth: '60px',
    transition: 'all 0.15s ease',
  },
  unitName: {
    fontSize: '10px',
    fontWeight: 700,
    color: '#e8e8e8',
    maxWidth: '68px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'center',
  },
  keywords: {
    display: 'flex',
    gap: '2px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: '2px',
  },
  keyword: {
    fontSize: '7px',
    padding: '1px 3px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '2px',
    color: '#888',
  },
  stats: {
    display: 'flex',
    gap: '8px',
    marginTop: '3px',
  },
  statNum: {
    fontSize: '12px',
    fontWeight: 800,
  },
  readyDot: {
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    marginTop: '3px',
  },
  attackBtn: {
    margin: '6px 8px',
    padding: '6px 12px',
    background: 'linear-gradient(135deg, #e63946, #c62828)',
    border: 'none',
    borderRadius: '5px',
    color: 'white',
    fontWeight: 700,
    fontSize: '11px',
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(230,57,70,0.3)',
  },
};
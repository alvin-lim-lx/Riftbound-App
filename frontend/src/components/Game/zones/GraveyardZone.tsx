/**
 * GraveyardZone — displays the discard pile / graveyard
 */

import React from 'react';
import type { CardInstance, CardDefinition } from '../../../shared/types';

interface Props {
  cards: string[];
  zoneName: string;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  compact?: boolean;
}

export function GraveyardZone({ cards, zoneName, allCards, cardDefs, compact }: Props) {
  const scale = compact ? 0.85 : 1;
  return (
    <div style={{ ...styles.container, transform: `scale(${scale})`, transformOrigin: 'center' }}>
      <div style={styles.label}>{zoneName}</div>
      <div style={styles.cardArea}>
        {cards.length > 0 ? (
          <>
            {/* Show top card face-up */}
            {(() => {
              const top = allCards[cards[cards.length - 1]];
              const def = top ? cardDefs[top.cardId] : null;
              return (
                <div style={styles.cardFace}>
                  <div style={styles.cardName}>{def?.name ?? '?'}</div>
                  {def?.stats && (
                    <div style={styles.stats}>
                      <span style={styles.might}>{def.stats.might ?? 0}</span>
                      <span style={styles.health}>♦{def.stats.health ?? 0}</span>
                    </div>
                  )}
                </div>
              );
            })()}
            {cards.length > 1 && (
              <div style={styles.more}>+{cards.length - 1}</div>
            )}
          </>
        ) : (
          <div style={styles.empty}>Empty</div>
        )}
      </div>
      <div style={styles.count}>{cards.length}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 8px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.08)',
    minWidth: '90px',
  },
  label: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: '#888',
    fontWeight: 600,
  },
  cardArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
  },
  cardFace: {
    width: '52px',
    height: '72px',
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
  },
  cardName: {
    fontSize: '9px',
    color: '#e8e8e8',
    textAlign: 'center',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '48px',
  },
  stats: {
    display: 'flex',
    gap: '6px',
    marginTop: '2px',
  },
  might: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#e63946',
  },
  health: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#e8e8e8',
  },
  more: {
    fontSize: '11px',
    color: '#888',
    fontStyle: 'italic',
  },
  count: {
    fontSize: '13px',
    color: '#888',
    fontWeight: 600,
  },
  empty: {
    width: '52px',
    height: '72px',
    border: '1px dashed rgba(255,255,255,0.15)',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#555',
    fontSize: '11px',
  },
};
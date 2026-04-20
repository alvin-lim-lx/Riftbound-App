/**
 * BaseZone — Battlefield card area.
 * Shows cards with type 'Battlefield' that are on the battlefield location.
 */

import React from 'react';
import type { CardInstance, CardDefinition } from '../../../shared/types';
import { CardArtView } from '../CardArtView';

interface Props {
  cards: string[];   // instance IDs passed from parent
  zoneLabel: string;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  playerId: string;
  compact?: boolean;
}

export function BaseZone({ cards, zoneLabel, allCards, cardDefs, playerId, compact }: Props) {
  const scale = compact ? 0.8 : 1;

  // Filter to actual Battlefield-type cards in the battlefield location
  const baseCards = cards
    .map(id => allCards[id])
    .filter(c => {
      if (!c) return false;
      const def = cardDefs[c.cardId];
      return def?.type === 'Battlefield' && c.location === 'battlefield';
    });

  return (
    <div
      style={{
        ...styles.container,
        transform: `scale(${scale})`,
        transformOrigin: 'center',
      }}
    >
      <div style={styles.label}>{zoneLabel}</div>
      <div style={styles.zone}>
        {baseCards.length > 0 ? (
          baseCards.map(card => (
            <CardArtView
              key={card.instanceId}
              card={card}
              cardDef={cardDefs[card.cardId]}
              isOpponent={card.ownerId !== playerId}
              showStats={false}
              showKeywords={false}
              size="md"
            />
          ))
        ) : (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>◇</div>
            <div style={styles.emptyText}>No Base</div>
          </div>
        )}
      </div>
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
    background: 'rgba(16,185,129,0.06)',
    borderRadius: '8px',
    border: '1px solid rgba(16,185,129,0.25)',
    minWidth: '90px',
    flex: 1,
  },
  label: {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    color: '#10b981',
    fontWeight: 700,
  },
  zone: {
    display: 'flex',
    gap: '5px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '80px',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 10px',
    border: '1px dashed rgba(16,185,129,0.3)',
    borderRadius: '8px',
  },
  emptyIcon: {
    fontSize: '20px',
    color: 'rgba(16,185,129,0.3)',
  },
  emptyText: {
    fontSize: '9px',
    color: 'rgba(16,185,129,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
};

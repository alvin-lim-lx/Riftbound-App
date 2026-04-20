/**
 * LegendZone — Legend card area (board champion).
 * Shows Legend-type cards that are either:
 *   - in the legendZone location, OR
 *   - in the battlefield location (game engine may store them there)
 * Also accepts explicit legendZone location cards.
 */

import React from 'react';
import type { CardInstance, CardDefinition } from '../../../shared/types';
import { CardArtView } from '../CardArtView';

interface Props {
  cards: string[];   // instance IDs from parent
  zoneLabel: string;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  playerId: string;
  compact?: boolean;
}

export function LegendZone({ cards, zoneLabel, allCards, cardDefs, playerId, compact }: Props) {
  const scale = compact ? 0.65 : 0.8;

  // Filter: Legend cards (type=Legend)
  // Location can be 'legendZone' OR 'battlefield' (engine stores there)
  const legendCards = cards
    .map(id => allCards[id])
    .filter(c => {
      if (!c) return false;
      const def = cardDefs[c.cardId];
      const isLegendType = def?.type === 'Legend';
      const inZone = c.location === 'legendZone' || c.location === 'battlefield';
      return isLegendType && inZone;
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
        {legendCards.length > 0 ? (
          legendCards.map(card => (
            <CardArtView
              key={card.instanceId}
              card={card}
              cardDef={cardDefs[card.cardId]}
              isOpponent={card.ownerId !== playerId}
              showStats={true}
              showKeywords={true}
              size="md"
            />
          ))
        ) : (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>★</div>
            <div style={styles.emptyText}>No Legend</div>
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
    background: 'rgba(212,168,67,0.06)',
    borderRadius: '8px',
    border: '1px solid rgba(212,168,67,0.25)',
    minWidth: '90px',
    flex: 1,
  },
  label: {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    color: '#d4a843',
    fontWeight: 700,
  },
  zone: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100px',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '8px 12px',
    border: '1px dashed rgba(212,168,67,0.3)',
    borderRadius: '8px',
  },
  emptyIcon: {
    fontSize: '24px',
    color: 'rgba(212,168,67,0.3)',
  },
  emptyText: {
    fontSize: '9px',
    color: 'rgba(212,168,67,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
};

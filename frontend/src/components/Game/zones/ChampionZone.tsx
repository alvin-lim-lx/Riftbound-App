/**
 * ChampionZone — Champion unit area.
 * Shows Champion cards (type=Unit + superType=Champion) that are either:
 *   - in the championZone location, OR
 *   - in the battlefield location (game engine may store them there)
 * Also accepts explicit championZone location cards.
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

export function ChampionZone({ cards, zoneLabel, allCards, cardDefs, playerId, compact }: Props) {
  const scale = compact ? 0.65 : 0.8;

  // Filter: Champion units (type=Unit + superType=Champion)
  // Location can be 'championZone' OR 'battlefield' (engine stores there)
  const champCards = cards
    .map(id => allCards[id])
    .filter(c => {
      if (!c) return false;
      const def = cardDefs[c.cardId];
      const isChampionType = def?.type === 'Unit' && def?.superType === 'Champion';
      const inZone = c.location === 'championZone' || c.location === 'battlefield';
      return isChampionType && inZone;
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
        {champCards.length > 0 ? (
          champCards.map(card => (
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
            <div style={styles.emptyIcon}>⚔</div>
            <div style={styles.emptyText}>No Champion</div>
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
    background: 'rgba(59,130,246,0.06)',
    borderRadius: '8px',
    border: '1px solid rgba(59,130,246,0.25)',
    minWidth: '90px',
    flex: 1,
  },
  label: {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    color: '#3b82f6',
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
    border: '1px dashed rgba(59,130,246,0.3)',
    borderRadius: '8px',
  },
  emptyIcon: {
    fontSize: '24px',
    color: 'rgba(59,130,246,0.3)',
  },
  emptyText: {
    fontSize: '9px',
    color: 'rgba(59,130,246,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
};

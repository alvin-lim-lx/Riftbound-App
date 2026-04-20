/**
 * RuneZone — displays the rune deck (hidden) and top of rune discard (visible)
 * Accent color for the rune theme: purple
 */

import React from 'react';
import type { CardInstance, CardDefinition } from '../../../shared/types';

interface Props {
  runeDeck: string[];
  runeDiscard: string[];
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  hidden?: boolean;
  compact?: boolean;
}

export function RuneZone({ runeDeck, runeDiscard, allCards, cardDefs, hidden, compact }: Props) {
  const scale = compact ? 0.85 : 1;
  const discardTop = runeDiscard.length > 0 ? allCards[runeDiscard[runeDiscard.length - 1]] : null;
  const discardDef = discardTop ? cardDefs[discardTop.cardId] : null;

  return (
    <div style={{ ...styles.container, transform: `scale(${scale})`, transformOrigin: 'center' }}>
      <div style={styles.label}>RUNE DECK</div>

      <div style={styles.content}>
        {/* Rune Deck (hidden indicator) */}
        <div style={styles.deckSection}>
          {hidden ? (
            <div style={styles.hiddenCard}>
              <div style={styles.hiddenRune}>❖</div>
            </div>
          ) : (
            <div style={styles.runeDeckFace}>
              <div style={styles.runeSymbol}>❖</div>
            </div>
          )}
          <div style={styles.deckCount}>{runeDeck.length}</div>
          <div style={styles.subLabel}>Deck</div>
        </div>

        {/* Separator */}
        <div style={styles.sep}>|</div>

        {/* Rune Discard (always visible) */}
        <div style={styles.deckSection}>
          {discardDef ? (
            <div style={styles.discardCard}>
              <div style={styles.discardName}>{discardDef.name}</div>
              <div style={styles.runeIconSmall}>◆</div>
            </div>
          ) : (
            <div style={styles.empty}>
              <div style={{ color: '#a78bfa60', fontSize: '14px' }}>—</div>
            </div>
          )}
          <div style={styles.discardCount}>{runeDiscard.length}</div>
          <div style={styles.subLabel}>Discard</div>
        </div>
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
    padding: '6px 10px',
    background: 'rgba(124,58,237,0.08)',
    borderRadius: '8px',
    border: '1px solid rgba(124,58,237,0.25)',
    minWidth: '130px',
  },
  label: {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    color: '#a78bfa',
    fontWeight: 700,
  },
  content: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  deckSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
  },
  hiddenCard: {
    width: '40px',
    height: '54px',
    background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(79,70,229,0.2))',
    border: '2px solid rgba(124,58,237,0.6)',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenRune: {
    fontSize: '18px',
    color: '#a78bfa',
  },
  runeDeckFace: {
    width: '40px',
    height: '54px',
    background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(79,70,229,0.15))',
    border: '1px solid rgba(124,58,237,0.5)',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  runeSymbol: {
    fontSize: '16px',
    color: '#a78bfa',
  },
  deckCount: {
    fontSize: '14px',
    fontWeight: 800,
    color: '#a78bfa',
  },
  discardCount: {
    fontSize: '14px',
    fontWeight: 800,
    color: '#888',
  },
  discardCard: {
    width: '40px',
    height: '54px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    padding: '3px',
  },
  discardName: {
    fontSize: '7px',
    color: '#e8e8e8',
    textAlign: 'center',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '36px',
  },
  runeIconSmall: {
    fontSize: '10px',
    color: '#a78bfa',
  },
  sep: {
    color: 'rgba(255,255,255,0.15)',
    fontSize: '18px',
  },
  subLabel: {
    fontSize: '8px',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  empty: {
    width: '40px',
    height: '54px',
    border: '1px dashed rgba(255,255,255,0.1)',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

/**
 * DeckZone — displays a deck with card count, hidden or face-up
 * Used for: Main Deck (hidden) and Rune Discard (visible)
 */

import React from 'react';
import type { CardInstance, CardDefinition } from '../../../shared/types';

interface Props {
  deck: string[];
  deckName: string;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  hidden?: boolean;
  accentColor?: string;
  compact?: boolean;
}

export function DeckZone({ deck, deckName, allCards, cardDefs, hidden, accentColor, compact }: Props) {
  const scale = compact ? 0.85 : 1;
  const topCard = deck.length > 0 ? allCards[deck[deck.length - 1]] : null;
  const def = topCard ? cardDefs[topCard.cardId] : null;
  const color = accentColor ?? '#3b82f6';

  return (
    <div style={{ ...styles.container, borderColor: color + '33', transform: `scale(${scale})`, transformOrigin: 'center' }}>
      <div style={{ ...styles.label, color: color }}>{deckName}</div>

      {hidden ? (
        // Hidden deck — show card back stack
        <div style={styles.hiddenStack}>
          <div style={{ ...styles.hiddenCard, borderColor: color + '44' }}>
            <div style={{ ...styles.hiddenCardInner, color: color + '80' }}>?</div>
          </div>
          <div style={{ ...styles.count, color: color + 'aa' }}>{deck.length}</div>
        </div>
      ) : (
        // Visible deck/discard — show top card face-up
        <div style={styles.visibleArea}>
          {deck.length > 0 && def ? (
            <div style={{ ...styles.cardFace, borderColor: color + '66', background: `linear-gradient(135deg, ${color}15, ${color}08)` }}>
              <div style={{ ...styles.cardName, color: '#e8e8e8' }}>{def.name}</div>
              {def.type === 'Rune' && (
                <div style={{ ...styles.runeSymbol, color: color }}>◆</div>
              )}
              {def.stats && (
                <div style={styles.stats}>
                  {def.stats.might !== undefined && (
                    <span style={{ ...styles.stat, color: '#e63946' }}>{def.stats.might}</span>
                  )}
                  {def.stats.health !== undefined && (
                    <span style={{ ...styles.stat, color: '#e8e8e8' }}>♦{def.stats.health}</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ ...styles.empty, borderColor: color + '33' }}>
              <div style={{ color: color + '60', fontSize: '16px' }}>—</div>
            </div>
          )}
          <div style={{ ...styles.count, color: color + 'aa' }}>{deck.length}</div>
        </div>
      )}
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
    border: '1px solid',
    minWidth: '80px',
  },
  label: {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    fontWeight: 700,
  },
  hiddenStack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  },
  hiddenCard: {
    width: '48px',
    height: '66px',
    background: 'linear-gradient(135deg, #2a2a4a 0%, #1a1a3a 100%)',
    border: '2px solid',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenCardInner: {
    fontSize: '22px',
    fontWeight: 800,
  },
  count: {
    fontSize: '13px',
    fontWeight: 800,
  },
  visibleArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  },
  cardFace: {
    width: '48px',
    height: '66px',
    border: '1px solid',
    borderRadius: '6px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    gap: '2px',
  },
  cardName: {
    fontSize: '8px',
    fontWeight: 700,
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '44px',
  },
  runeSymbol: {
    fontSize: '12px',
    fontWeight: 800,
  },
  stats: {
    display: 'flex',
    gap: '5px',
  },
  stat: {
    fontSize: '11px',
    fontWeight: 800,
  },
  empty: {
    width: '48px',
    height: '66px',
    border: '1px dashed',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

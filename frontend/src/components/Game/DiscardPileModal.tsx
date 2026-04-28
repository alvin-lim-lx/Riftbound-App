/**
 * DiscardPileModal - centered overlay showing all cards in a player's discard pile.
 * Opens when the player clicks the graveyard CardStack.
 */
import React from 'react';
import { CardArtView } from './CardArtView';
import type { CardInstance, CardDefinition } from '../../shared/types';

interface Props {
  /** "Your Discard" or "Opponent's Discard" */
  title: string;
  /** Ordered list of CardInstance.instanceId — top of discard is last */
  discardPile: string[];
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  accentColor: string;
  onClose: () => void;
}

export function DiscardPileModal({
  title,
  discardPile,
  allCards,
  cardDefs,
  accentColor,
  onClose,
}: Props) {
  // Build the card list — newest first (top of discard = last in array)
  const cards = discardPile
    .slice()
    .reverse()
    .map(id => allCards[id])
    .filter(Boolean) as CardInstance[];

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div
        style={styles.modal}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={{ ...styles.dot, background: accentColor }} />
            <h2 style={styles.title}>{title}</h2>
            <span style={styles.count}>{cards.length} card{cards.length !== 1 ? 's' : ''}</span>
          </div>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {/* Card grid */}
        {cards.length === 0 ? (
          <div style={styles.empty}>
            <span style={{ color: '#555', fontSize: '14px', fontStyle: 'italic' }}>
              No cards in discard pile.
            </span>
          </div>
        ) : (
          <div style={styles.grid}>
            {cards.map(card => {
              const def = cardDefs[card.cardId];
              return (
                <div key={card.instanceId} style={styles.cardWrapper}>
                  <CardArtView
                    card={card}
                    cardDef={def}
                    isOpponent={false}
                    showStats={true}
                    showKeywords={true}
                    size="md"
                    forceReady={true}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.82)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: 'linear-gradient(180deg, #1e1b35 0%, #111827 100%)',
    border: `1px solid rgba(148,163,184,0.28)`,
    borderRadius: '14px',
    padding: '24px 28px',
    maxWidth: '860px',
    width: '90vw',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    boxShadow: '0 24px 64px rgba(0,0,0,0.62)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  title: {
    color: '#f8fafc',
    fontSize: '20px',
    fontWeight: 900,
    margin: 0,
  },
  count: {
    color: '#64748b',
    fontSize: '13px',
    fontWeight: 600,
    marginLeft: '4px',
  },
  closeBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '6px',
    color: '#94a3b8',
    fontSize: '16px',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 0',
  },
  grid: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    overflowY: 'auto',
    paddingBottom: '4px',
  },
  cardWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
};

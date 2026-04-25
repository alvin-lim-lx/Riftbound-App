/**
 * HandZone — displays hand cards. Opponent's hand is hidden, player's is visible.
 */

import React from 'react';
import type { CardInstance, CardDefinition, Phase } from '../../../shared/types';

interface Props {
  playerId: string;
  playerName: string;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  isOpponent: boolean;
  mana?: number;
  onPlayCard?: (cardId: string, bfId: string, hidden: boolean, accelerate: boolean) => void;
  onPlaySpell?: (cardId: string, targetId?: string) => void;
}

export function HandZone({ playerId, playerName, allCards, cardDefs, isOpponent, mana, onPlayCard, onPlaySpell }: Props) {
  const player = Object.values(allCards).filter(
    c => c.ownerId === playerId && c.location === 'hand'
  );

  const playablePhases: Phase[] = ['Action', 'Showdown'];

  return (
    <div style={styles.cards}>
        {player.map(card => {
          if (isOpponent) {
            return (
              <div key={card.instanceId} style={styles.hiddenCard}>
                <div style={styles.hiddenCardInner}>?</div>
              </div>
            );
          }
          const def = cardDefs[card.cardId];
          const canPlay = def?.cost && def.cost.rune <= (mana ?? 0);
          return (
            <HandCard
              key={card.instanceId}
              card={card}
              def={def}
              canPlay={!!canPlay}
              onPlay={() => {
                if (def?.type === 'Unit') {
                  onPlayCard?.(card.instanceId, 'bf_0', false, false);
                } else if (def?.type === 'Spell') {
                  onPlaySpell?.(card.instanceId);
                }
              }}
            />
          );
        })}
        {player.length === 0 && (
          <div style={styles.empty}>No cards</div>
        )}
      </div>
  );
}

function HandCard({ card, def, canPlay, onPlay }: {
  card: CardInstance;
  def?: CardDefinition;
  canPlay: boolean;
  onPlay: () => void;
}) {
  const [hover, setHover] = React.useState(false);

  const typeColors: Record<string, string> = {
    Unit: '#3b82f6',
    Spell: '#a855f7',
    Gear: '#f59e0b',
    Battlefield: '#10b981',
    Legend: '#d4a843',
    Rune: '#7c3aed',
  };
  const color = def ? (typeColors[def.type] ?? '#6b7280') : '#6b7280';

  return (
    <div
      style={{
        ...styles.card,
        borderColor: canPlay ? color : 'rgba(255,255,255,0.15)',
        opacity: canPlay ? 1 : 0.65,
        transform: hover ? 'translateY(-6px) scale(1.04)' : 'translateY(0)',
        boxShadow: hover ? '0 6px 14px rgba(0,0,0,0.3)' : '0 2px 4px rgba(0,0,0,0.15)',
        cursor: canPlay ? 'pointer' : 'default',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={canPlay ? onPlay : undefined}
    >
      {def?.cost && (
        <div style={{ ...styles.cost, color }}>{def.cost.rune}◆</div>
      )}
      <div style={styles.cardName}>{def?.name ?? card.cardId}</div>
      <div style={{ ...styles.typeTag, background: color + '22', color }}>{def?.type}</div>
      {def?.stats && (
        <div style={styles.stats}>
          <span style={styles.might}>{def.stats.might ?? 0}</span>
          <span style={styles.health}>♦{def.stats.health ?? 0}</span>
        </div>
      )}
      {def?.keywords && def.keywords.length > 0 && (
        <div style={styles.keywords}>
          {def.keywords.slice(0, 2).map(kw => (
            <span key={kw} style={styles.keyword}>{kw}</span>
          ))}
        </div>
      )}
      {canPlay && hover && (
        <div style={styles.playHint}>Click to play</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  name: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#e8e8e8',
  },
  label: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: '#888',
  },
  mana: {
    fontSize: '12px',
    color: '#e63946',
    fontWeight: 700,
  },
  cards: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    padding: '2px 0',
  },
  hiddenCard: {
    width: '48px',
    height: '66px',
    background: 'linear-gradient(135deg, #2a2a4a, #1a1a3a)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenCardInner: {
    fontSize: '20px',
    color: 'rgba(255,255,255,0.25)',
    fontWeight: 800,
  },
  empty: {
    color: '#555',
    fontSize: '12px',
    fontStyle: 'italic',
    padding: '8px 16px',
  },
  card: {
    minWidth: '100px',
    maxWidth: '120px',
    padding: '8px 6px',
    background: 'rgba(30,30,50,0.8)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '3px',
    transition: 'all 0.15s ease',
    position: 'relative',
  },
  cost: {
    position: 'absolute',
    top: '4px',
    right: '6px',
    fontSize: '11px',
    fontWeight: 800,
  },
  cardName: {
    fontSize: '10px',
    fontWeight: 700,
    color: '#e8e8e8',
    textAlign: 'center',
    marginTop: '6px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '90px',
  },
  typeTag: {
    fontSize: '8px',
    padding: '1px 5px',
    borderRadius: '3px',
    textTransform: 'uppercase',
    fontWeight: 700,
  },
  stats: {
    display: 'flex',
    gap: '8px',
    marginTop: '2px',
  },
  might: {
    fontSize: '13px',
    fontWeight: 800,
    color: '#e63946',
  },
  health: {
    fontSize: '13px',
    fontWeight: 800,
    color: '#e8e8e8',
  },
  keywords: {
    display: 'flex',
    gap: '3px',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  keyword: {
    fontSize: '8px',
    padding: '1px 4px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '3px',
    color: '#aaa',
  },
  playHint: {
    position: 'absolute',
    bottom: '-8px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '10px',
    color: '#e63946',
    fontWeight: 700,
    background: 'rgba(0,0,0,0.8)',
    padding: '2px 8px',
    borderRadius: '4px',
    whiteSpace: 'nowrap',
  },
};
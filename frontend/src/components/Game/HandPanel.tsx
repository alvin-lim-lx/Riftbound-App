/**
 * HandPanel — displays player's hand of cards
 */

import React from 'react';
import type { CardInstance, CardDefinition, Phase } from '../../shared/types';

interface Props {
  playerId: string;
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  myTurn: boolean;
  phase: Phase;
  mana: number;
  onPlayCard: (cardId: string, bfId: string, hidden: boolean, accelerate: boolean) => void;
  onPlaySpell: (cardId: string, targetId?: string) => void;
  onSelectCard: (cardId: string) => void;
}

export function HandPanel({ playerId, allCards, cardDefs, myTurn, phase, mana, onPlayCard, onPlaySpell, onSelectCard }: Props) {
  const handCards = Object.values(allCards).filter(c => c.location === 'hand' && c.ownerId === playerId);

  const playablePhases: Phase[] = ['FirstMain', 'SecondMain', 'Combat', 'Showdown'];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.label}>Your Hand</span>
        <span style={styles.mana}>
          {mana && (
            <span style={styles.manaIcon}>◆</span>
          )}
          {mana !== undefined ? ` ${mana} Runes` : ''}
        </span>
      </div>
      <div style={styles.cards}>
        {handCards.map(card => {
          const def = cardDefs[card.cardId];
          const canPlay = myTurn && playablePhases.includes(phase) &&
            def?.cost && def.cost.rune <= mana;

          return (
            <HandCard
              key={card.instanceId}
              card={card}
              def={def}
              canPlay={canPlay ?? false}
              onPlay={() => {
                if (def?.type === 'Unit') {
                  // Default to first battlefield
                  onPlayCard(card.instanceId, 'bf_0', false, false);
                } else if (def?.type === 'Spell') {
                  onPlaySpell(card.instanceId);
                }
              }}
              onClick={() => onSelectCard(card.instanceId)}
            />
          );
        })}
        {handCards.length === 0 && (
          <div style={styles.empty}>No cards in hand</div>
        )}
      </div>
    </div>
  );
}

function HandCard({ card, def, canPlay, onPlay, onClick }: {
  card: CardInstance; def?: CardDefinition; canPlay: boolean; onPlay: () => void; onClick: () => void;
}) {
  const [hover, setHover] = React.useState(false);

  const typeColor: Record<string, string> = {
    Unit: '#3b82f6',
    Spell: '#a855f7',
    Gear: '#f59e0b',
    Battlefield: '#10b981',
  };
  const color = def ? typeColor[def.type] ?? '#6b7280' : '#6b7280';

  return (
    <div
      style={{
        ...styles.card,
        borderColor: canPlay ? '#e63946' : '#e5e5e5',
        opacity: canPlay ? 1 : 0.6,
        transform: hover ? 'translateY(-8px) scale(1.05)' : 'translateY(0)',
        cursor: canPlay ? 'pointer' : 'default',
        boxShadow: hover ? '0 8px 16px rgba(0,0,0,0.12)' : '0 2px 4px rgba(0,0,0,0.08)',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      <div style={styles.cardCost}>
        {def?.cost?.rune ?? 0}◆{def?.cost?.charges ? `+${def.cost.charges}◆` : ''}
      </div>
      <div style={styles.cardName}>{def?.name ?? card.cardId}</div>
      <div style={styles.cardType}>{def?.type}</div>
      {def?.keywords && def.keywords.length > 0 && (
        <div style={styles.keywords}>
          {def.keywords.slice(0, 2).map(kw => (
            <span key={kw} style={styles.keyword}>{kw}</span>
          ))}
        </div>
      )}
      {def?.stats && (
        <div style={styles.stats}>
          <span style={styles.mightStat}>{def.stats.might ?? 0}</span>
          <span style={styles.healthStat}>♦{def.stats.health ?? 0}</span>
        </div>
      )}
      {canPlay && hover && (
        <button
          style={styles.playBtn}
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
        >
          Play
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { height: '100%', display: 'flex', flexDirection: 'column', gap: '8px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: '13px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px' },
  mana: { fontSize: '14px', color: '#e63946', fontWeight: 600 },
  manaIcon: { color: '#e63946' },
  cards: { display: 'flex', gap: '10px', overflowX: 'auto', padding: '4px', flex: 1, alignItems: 'flex-start' },
  empty: { color: '#9ca3af', fontStyle: 'italic', fontSize: '13px', width: '100%', textAlign: 'center', paddingTop: '20px' },
  card: {
    minWidth: '110px',
    maxWidth: '130px',
    padding: '10px 8px',
    background: '#ffffff',
    border: '1px solid #e5e5e5',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    transition: 'all 0.15s ease',
    position: 'relative',
    boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
  },
  cardCost: { fontSize: '12px', fontWeight: 700, color: '#e63946', position: 'absolute', top: '4px', right: '6px' },
  cardName: { fontSize: '11px', fontWeight: 700, color: '#1a1a1a', textAlign: 'center', marginTop: '8px' },
  cardType: { fontSize: '9px', color: '#6b7280', textTransform: 'uppercase' },
  keywords: { display: 'flex', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' },
  keyword: { fontSize: '8px', padding: '1px 4px', background: '#f3f4f6', borderRadius: '3px', color: '#6b7280' },
  stats: { display: 'flex', gap: '10px', marginTop: '4px' },
  mightStat: { fontSize: '14px', fontWeight: 700, color: '#e63946' },
  healthStat: { fontSize: '14px', fontWeight: 700, color: '#1a1a1a' },
  playBtn: {
    position: 'absolute', bottom: '-10px', left: '50%', transform: 'translateX(-50%)',
    padding: '4px 14px', background: '#e63946', border: 'none', borderRadius: '6px',
    color: 'white', fontWeight: 600, fontSize: '11px', cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(230,57,70,0.3)',
  },
};

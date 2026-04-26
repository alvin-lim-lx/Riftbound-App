/**
 * MulliganOverlay - opening-hand keep/replace decision.
 */
import React, { useState, useEffect } from 'react';
import { gameService } from '../../services/gameService';
import { CardArtView } from './CardArtView';
import type { CardInstance, CardDefinition } from '../../shared/types';

interface Props {
  playerId: string;
  hand: CardInstance[];
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  isMyTurn: boolean;
}

export function MulliganOverlay({ playerId, hand, cardDefs, isMyTurn }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(hand.map(c => c.instanceId))
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleCard(instanceId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(instanceId)) {
        const replaceCount = hand.length - next.size;
        if (replaceCount >= 2) return next;
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (isSubmitting) {
        console.warn('[MulliganOverlay] Safety timeout - force-dismissing');
        setIsSubmitting(false);
      }
    }, 8000);

    const handler = (data: any) => {
      if (data.state && data.state.phase !== 'Mulligan') {
        setIsSubmitting(false);
      }
    };
    gameService.on('game_state_update', handler);
    return () => {
      clearTimeout(timeout);
      gameService.off('game_state_update', handler);
    };
  }, [isSubmitting]);

  function handleConfirm() {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const keepIds = hand.filter(c => selected.has(c.instanceId)).map(c => c.instanceId);
    gameService.submitAction({
      id: `mulligan-${Date.now()}`,
      type: 'Mulligan',
      playerId,
      turn: 0,
      phase: 'Mulligan',
      payload: { keepIds },
      timestamp: Date.now(),
    });
  }

  const keepCount = selected.size;
  const replaceCount = hand.length - keepCount;
  const canSubmit = isMyTurn && !isSubmitting && replaceCount <= 2;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>Mulligan</h2>
            <p style={styles.subtitle}>Choose the cards to keep. You may replace up to 2 cards, then draw replacements.</p>
          </div>
          <div style={styles.summary}>
            <span style={styles.keepCount}>{keepCount} keep</span>
            <span style={styles.replaceCount}>{replaceCount} replace</span>
          </div>
        </div>

        <div style={styles.cardGrid}>
          {hand.map(card => {
            const def = cardDefs[card.cardId];
            const isSelected = selected.has(card.instanceId);
            return (
              <button
                key={card.instanceId}
                type="button"
                style={{
                  ...styles.cardWrapper,
                  opacity: isSelected ? 1 : 0.58,
                  borderColor: isSelected ? '#22c55e' : '#f97316',
                  background: isSelected ? 'rgba(34,197,94,0.1)' : 'rgba(249,115,22,0.1)',
                }}
                onClick={() => isMyTurn && !isSubmitting && toggleCard(card.instanceId)}
                disabled={!isMyTurn || isSubmitting}
                title={isSelected && replaceCount >= 2 ? 'You can replace up to 2 cards' : isSelected ? 'Click to replace this card' : 'Click to keep this card'}
              >
                <CardArtView
                  card={card}
                  cardDef={def}
                  isOpponent={false}
                  showStats={true}
                  showKeywords={true}
                  size="lg"
                />
                <div style={{
                  ...styles.keepBadge,
                  background: isSelected ? '#22c55e' : '#f97316',
                }}>
                  {isSelected ? 'KEEP' : 'REPLACE'}
                </div>
              </button>
            );
          })}
        </div>

        <div style={styles.footer}>
          <span style={styles.count}>
            Keeping {keepCount}; replacing {replaceCount}
          </span>
          <button
            style={{
              ...styles.confirmBtn,
              opacity: canSubmit ? 1 : 0.55,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
            onClick={handleConfirm}
            disabled={!canSubmit}
          >
            {isSubmitting ? 'Submitting...' : replaceCount > 0 ? `Replace ${replaceCount} and Start` : 'Keep All and Start'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.78)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(3px)',
  },
  modal: {
    background: 'linear-gradient(180deg, #1e1b35 0%, #111827 100%)',
    border: '1px solid rgba(148,163,184,0.28)',
    borderRadius: '14px',
    padding: '28px 32px',
    maxWidth: '760px',
    width: '90vw',
    boxShadow: '0 24px 64px rgba(0,0,0,0.62)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '24px',
    alignItems: 'flex-start',
    marginBottom: '22px',
  },
  title: {
    color: '#f8fafc',
    fontSize: '24px',
    fontWeight: 900,
    margin: '0 0 6px',
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: '14px',
    margin: 0,
    lineHeight: 1.45,
    maxWidth: '520px',
  },
  summary: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '6px',
    flexShrink: 0,
  },
  keepCount: {
    color: '#86efac',
    fontSize: '12px',
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  replaceCount: {
    color: '#fdba74',
    fontSize: '12px',
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  cardGrid: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: '24px',
  },
  cardWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    borderRadius: '12px',
    transition: 'opacity 0.15s, border-color 0.15s, background 0.15s',
    padding: '7px',
    border: '2px solid',
  },
  keepBadge: {
    fontSize: '11px',
    fontWeight: 900,
    padding: '4px 11px',
    borderRadius: '999px',
    color: '#fff',
    letterSpacing: '0.6px',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
  },
  count: {
    color: '#cbd5e1',
    fontSize: '14px',
    fontWeight: 700,
  },
  confirmBtn: {
    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '8px',
    padding: '11px 24px',
    fontSize: '15px',
    fontWeight: 900,
    transition: 'opacity 0.15s',
    boxShadow: '0 8px 20px rgba(34,197,94,0.2)',
  },
};

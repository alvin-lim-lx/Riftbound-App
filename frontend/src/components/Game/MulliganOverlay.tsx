/**
 * MulliganOverlay — shown during the Mulligan phase.
 * Player clicks cards to select which to KEEP; non-kept cards go back to deck.
 * Rule 118: draw back up to 4 cards after the exchange.
 */

import React, { useState, useEffect } from 'react';
import { gameService } from '../../services/gameService';
import { CardArtView } from './CardArtView';
import type { CardInstance, CardDefinition } from '../../shared/types';

interface Props {
  playerId: string;
  hand: CardInstance[];          // 4 CardInstances in hand
  allCards: Record<string, CardInstance>;
  cardDefs: Record<string, CardDefinition>;
  isMyTurn: boolean;
}

export function MulliganOverlay({ playerId, hand, allCards, cardDefs, isMyTurn }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(hand.map(c => c.instanceId))
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleCard(instanceId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  }

  // Dismiss overlay when backend advances phase (e.g. after mulligan is accepted)
  // Also add a safety timeout in case the WS message gets lost
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (isSubmitting) {
        console.warn('[MulliganOverlay] Safety timeout — force-dismissing');
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
      type: 'Mulligan',
      playerId,
      turn: 0,
      phase: 'Mulligan',
      payload: { keepIds },
    });
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.title}>⚄ Mulligan Phase</h2>
        <p style={styles.subtitle}>
          Click cards you want to <strong>KEEP</strong>. The rest will be shuffled back into your deck.
          You will draw back up to 4 cards.
        </p>

        <div style={styles.cardGrid}>
          {hand.map(card => {
            const def = cardDefs[card.cardId];
            const isSelected = selected.has(card.instanceId);
            return (
              <div
                key={card.instanceId}
                style={{
                  ...styles.cardWrapper,
                  opacity: isSelected ? 1 : 0.4,
                  boxShadow: isSelected ? '0 0 0 3px #22c55e' : 'none',
                }}
                onClick={() => isMyTurn && !isSubmitting && toggleCard(card.instanceId)}
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
                  background: isSelected ? '#22c55e' : 'rgba(255,255,255,0.1)',
                }}>
                  {isSelected ? '✓ KEEP' : 'DISCARD'}
                </div>
              </div>
            );
          })}
        </div>

        <div style={styles.footer}>
          <span style={styles.count}>
            Keeping {selected.size} of {hand.length} cards
          </span>
          <button
            style={{
              ...styles.confirmBtn,
              opacity: (!isMyTurn || isSubmitting) ? 0.5 : 1,
              cursor: (!isMyTurn || isSubmitting) ? 'not-allowed' : 'pointer',
            }}
            onClick={handleConfirm}
            disabled={!isMyTurn || isSubmitting}
          >
            {isSubmitting ? 'Submitting…' : 'Confirm Mulligan'}
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
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '16px',
    padding: '32px',
    maxWidth: '720px',
    width: '90vw',
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  },
  title: {
    color: '#e8e8e8',
    fontSize: '22px',
    fontWeight: 700,
    margin: '0 0 8px',
    textAlign: 'center' as const,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: '14px',
    margin: '0 0 24px',
    textAlign: 'center' as const,
    lineHeight: 1.5,
  },
  cardGrid: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
    flexWrap: 'wrap' as const,
    marginBottom: '24px',
  },
  cardWrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    borderRadius: '10px',
    transition: 'opacity 0.15s, box-shadow 0.15s',
    padding: '4px',
  },
  keepBadge: {
    fontSize: '11px',
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: '20px',
    color: '#fff',
    letterSpacing: '0.5px',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
  },
  count: {
    color: '#9ca3af',
    fontSize: '14px',
  },
  confirmBtn: {
    background: '#22c55e',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 24px',
    fontSize: '15px',
    fontWeight: 700,
    transition: 'opacity 0.15s',
  },
};

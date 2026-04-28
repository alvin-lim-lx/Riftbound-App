/**
 * PlayerPanel — score, mana, and basic info for a player
 */
import React from 'react';
import type { PlayerState, CardDefinition } from '../../shared/types';

interface Props {
  player: PlayerState;
  isOpponent?: boolean;
  cardDefs: Record<string, CardDefinition>;
}

export function PlayerPanel({ player, isOpponent, cardDefs }: Props) {
  const styles: Record<string, React.CSSProperties> = {
    panel: {
      display: 'flex',
      alignItems: 'center',
      gap: '20px',
      padding: '8px 16px',
    },
    avatar: {
      width: '40px', height: '40px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, #e63946, #d4a843)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '18px', fontWeight: 700, color: 'white',
      border: '2px solid #e5e5e5',
    },
    info: { display: 'flex', flexDirection: 'column', gap: '2px' },
    name: { fontWeight: 600, fontSize: '14px', color: '#1a1a1a' },
    score: { display: 'flex', alignItems: 'center', gap: '16px' },
    stat: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' },
    manaText: { color: '#e63946' },
    xpText: { color: '#d4a843' },
    deckCount: { color: '#6b7280', fontSize: '12px' },
    handCount: { color: '#9ca3af', fontSize: '12px' },
    scoreVal: { fontSize: '22px', fontWeight: 700, color: '#d4a843' },
  };

  return (
    <div style={styles.panel}>
      <div style={styles.avatar}>
        {player.name.charAt(0).toUpperCase()}
      </div>
      <div style={styles.info}>
        <div style={styles.name}>
          {player.name} {isOpponent ? '(Opponent)' : '(You)'}
        </div>
        <div style={styles.score}>
          <div style={styles.stat}>
            <span style={styles.scoreVal}>★ {player.score}</span>
          </div>
          {!isOpponent && (
            <>
              <div style={styles.stat}>
                <span>◆ {player.energy}/{player.maxEnergy}</span>
              </div>
              <div style={styles.stat}>
                <span>✦ {player.xp} XP</span>
              </div>
              <div style={styles.stat}>
                <span>⚡ {player.charges} charges</span>
              </div>
            </>
          )}
          <div style={styles.handCount}>
            {isOpponent ? `Hand: ${player.hand.length} cards` : `Deck: ${player.deck.length} cards`}
          </div>
        </div>
      </div>
    </div>
  );
}

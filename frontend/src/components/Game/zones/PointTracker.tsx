/**
 * PointTracker — displays score, mana, XP, charges for a player
 * Compact sidebar-style display
 */

import React from 'react';
import type { PlayerState, CardDefinition } from '../../../shared/types';

interface Props {
  player: PlayerState | undefined;
  cardDefs: Record<string, CardDefinition>;
  isOpponent: boolean;
  compact?: boolean;
}

export function PointTracker({ player, isOpponent, compact }: Props) {
  if (!player) return null;

  const scale = compact ? 0.8 : 1;

  return (
    <div style={{ ...styles.container, transform: `scale(${scale})`, transformOrigin: 'center' }}>
      {/* Score */}
      <div style={styles.scoreSection}>
        <div style={styles.star}>★</div>
        <div style={styles.scoreNum}>{player.score}</div>
        <div style={styles.scoreLabel}>SCORE</div>
      </div>

      {!isOpponent && (
        <>
          <div style={styles.divider} />
          <div style={styles.resourcesSection}>
            <div style={styles.resourceRow}>
              <div style={styles.runeIcon}>◆</div>
              <div style={styles.runeValue}>{player.mana}/{player.maxMana}</div>
            </div>
            <div style={styles.resourceRow}>
              <div style={styles.xpIcon}>✦</div>
              <div style={styles.xpValue}>{player.xp}</div>
            </div>
            <div style={styles.resourceRow}>
              <div style={styles.chargesIcon}>⚡</div>
              <div style={styles.chargesValue}>{player.charges}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.1)',
  },
  scoreSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1px',
  },
  star: {
    fontSize: '14px',
    color: '#d4a843',
    lineHeight: 1,
  },
  scoreNum: {
    fontSize: '20px',
    fontWeight: 900,
    color: '#d4a843',
    lineHeight: 1,
  },
  scoreLabel: {
    fontSize: '7px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: '#d4a84380',
    fontWeight: 700,
  },
  divider: {
    width: '1px',
    height: '32px',
    background: 'rgba(255,255,255,0.12)',
    margin: '0 2px',
  },
  resourcesSection: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10px',
  },
  resourceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
  },
  runeIcon: {
    fontSize: '10px',
    color: '#e63946',
  },
  runeValue: {
    fontSize: '13px',
    fontWeight: 800,
    color: '#e63946',
  },
  xpIcon: {
    fontSize: '10px',
    color: '#d4a843',
  },
  xpValue: {
    fontSize: '13px',
    fontWeight: 800,
    color: '#d4a843',
  },
  chargesIcon: {
    fontSize: '10px',
    color: '#60a5fa',
  },
  chargesValue: {
    fontSize: '13px',
    fontWeight: 800,
    color: '#60a5fa',
  },
};

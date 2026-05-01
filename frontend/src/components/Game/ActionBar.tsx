/**
 * ActionBar - bottom command strip for the active player.
 */
import React from 'react';
import type { Phase } from '../../shared/types';
import { getPhaseLabel, getTurnPrompt } from './PhaseIndicator';

interface Props {
  myTurn: boolean;
  phase: Phase;
  canPass?: boolean;
  onPass: () => void;
}

export function ActionBar({ myTurn, phase, canPass, onPass }: Props) {
  const showPass = canPass ?? (myTurn && phase === 'Action');
  const prompt = getTurnPrompt(phase, myTurn);

  return (
    <div style={styles.bar}>
      <div style={styles.commandText}>
        <span style={{ ...styles.phaseBadge, borderColor: myTurn ? '#f97316' : '#475569', color: myTurn ? '#fdba74' : '#cbd5e1' }}>
          {getPhaseLabel(phase)}
        </span>
        <span style={styles.prompt}>{prompt}</span>
      </div>

      {showPass ? (
        <button
          onClick={onPass}
          style={styles.passButton}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 8px 20px rgba(249,115,22,0.28)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 14px rgba(249,115,22,0.22)';
          }}
        >
          {phase === 'Showdown' ? 'Pass Focus' : 'Pass Turn'}
        </button>
      ) : (
        <div style={styles.aiState}>
          <span style={styles.pulseDot} />
          <span>{myTurn ? 'Resolve the current phase' : 'AI thinking'}</span>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    padding: '9px 18px',
    background: 'linear-gradient(180deg, rgba(15,23,42,0.98), rgba(2,6,23,0.98))',
    borderTop: '1px solid rgba(148,163,184,0.18)',
    boxShadow: '0 -10px 26px rgba(0,0,0,0.28)',
    minHeight: '48px',
    flexShrink: 0,
  },
  commandText: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
  },
  phaseBadge: {
    border: '1px solid',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    whiteSpace: 'nowrap',
    background: 'rgba(15,23,42,0.8)',
  },
  prompt: {
    color: '#dbeafe',
    fontSize: '13px',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  passButton: {
    padding: '10px 28px',
    background: 'linear-gradient(135deg, #f97316, #dc2626)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    color: 'white',
    fontWeight: 900,
    fontSize: '13px',
    cursor: 'pointer',
    letterSpacing: '0.4px',
    transition: 'all 0.15s ease',
    boxShadow: '0 4px 14px rgba(249,115,22,0.22)',
    flexShrink: 0,
  },
  aiState: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#94a3b8',
    fontSize: '12px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
  },
  pulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#38bdf8',
    boxShadow: '0 0 12px rgba(56,189,248,0.8)',
  },
};

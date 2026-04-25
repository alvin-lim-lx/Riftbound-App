/**
 * PhaseIndicator - compact, legible turn flow for the top bar.
 */
import React from 'react';
import type { Phase } from '../../shared/types';

interface Props {
  phase: Phase;
  turn: number;
  myTurn: boolean;
}

const PHASE_STEPS: Array<{ id: Phase; label: string }> = [
  { id: 'Awaken', label: 'Awaken' },
  { id: 'Beginning', label: 'Begin' },
  { id: 'Channel', label: 'Channel' },
  { id: 'Draw', label: 'Draw' },
  { id: 'Action', label: 'Action' },
  { id: 'End', label: 'End' },
];

function phaseIndex(phase: Phase): number {
  if (phase === 'Showdown') return PHASE_STEPS.findIndex(step => step.id === 'Action');
  return PHASE_STEPS.findIndex(step => step.id === phase);
}

export function getPhaseLabel(phase: Phase): string {
  return phase.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function getTurnPrompt(phase: Phase, myTurn: boolean): string {
  if (phase === 'Mulligan') return myTurn ? 'Choose which opening cards to keep.' : 'Waiting for opponent to mulligan.';
  if (phase === 'Action') return myTurn ? 'Play cards, move or attack, use abilities, or pass.' : 'AI is choosing its action.';
  if (phase === 'Showdown') return myTurn ? 'Resolve the showdown.' : 'AI is resolving the showdown.';
  if (phase === 'GameOver') return 'Game complete.';
  return myTurn ? 'Review the board as the phase advances.' : 'AI is resolving this phase.';
}

export function PhaseIndicator({ phase, turn, myTurn }: Props) {
  const currentIndex = phaseIndex(phase);

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <span style={{ ...styles.turnPill, borderColor: myTurn ? '#f97316' : '#64748b', color: myTurn ? '#fed7aa' : '#cbd5e1' }}>
          Turn {turn}
        </span>
        <span style={{ ...styles.statusPill, background: myTurn ? 'rgba(249,115,22,0.18)' : 'rgba(100,116,139,0.18)', color: myTurn ? '#fb923c' : '#cbd5e1' }}>
          {myTurn ? 'Your turn' : 'AI turn'}
        </span>
      </div>
      <div style={styles.steps}>
        {PHASE_STEPS.map((step, i) => {
          const isActive = i === currentIndex;
          const isPast = currentIndex > i;
          return (
            <React.Fragment key={step.id}>
              <div
                style={{
                  ...styles.step,
                  background: isActive ? '#f97316' : isPast ? 'rgba(34,197,94,0.22)' : 'rgba(255,255,255,0.06)',
                  borderColor: isActive ? '#fdba74' : isPast ? '#22c55e' : 'rgba(255,255,255,0.12)',
                  color: isActive ? '#111827' : isPast ? '#bbf7d0' : '#94a3b8',
                }}
                title={step.label}
              >
                {step.label}
              </div>
              {i < PHASE_STEPS.length - 1 && (
                <div style={{ ...styles.connector, background: isPast ? '#22c55e' : 'rgba(255,255,255,0.12)' }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    minWidth: '460px',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  turnPill: {
    border: '1px solid',
    borderRadius: '999px',
    padding: '2px 9px',
    fontSize: '11px',
    fontWeight: 800,
    background: 'rgba(15,23,42,0.8)',
  },
  statusPill: {
    borderRadius: '999px',
    padding: '3px 10px',
    fontSize: '11px',
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  steps: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  step: {
    minWidth: '52px',
    height: '24px',
    borderRadius: '999px',
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  connector: {
    width: '14px',
    height: '2px',
    borderRadius: '2px',
  },
};

/**
 * PhaseIndicator — shows current phase in the game turn order
 */
import React from 'react';
import type { Phase } from '../../shared/types';

interface Props {
  phase: Phase;
  turn: number;
  myTurn: boolean;
}

const PHASE_STEPS: Phase[] = ['Beginning', 'FirstMain', 'Combat', 'SecondMain', 'End'];

const PHASE_ICONS: Record<string, string> = {
  Beginning: '🌅',
  FirstMain: '⚔️',
  Combat: '⚔️',
  SecondMain: '🪄',
  End: '🌙',
  Showdown: '💥',
  GameOver: '🏆',
};

export function PhaseIndicator({ phase, turn, myTurn }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <span style={{ fontWeight: 700, fontSize: '14px', color: myTurn ? '#e63946' : '#6b7280' }}>
        {myTurn ? '● YOUR TURN' : '○ OPPONENT'}
      </span>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {PHASE_STEPS.map((p, i) => {
          const isActive = p === phase || (phase === 'Showdown' && p === 'Combat');
          const isPast = PHASE_STEPS.indexOf(phase) > i;
          return (
            <React.Fragment key={p}>
              <div style={{
                width: '28px', height: '28px',
                borderRadius: '50%',
                background: isActive ? '#e63946' : isPast ? '#22c55e' : '#e5e5e5',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px',
                border: isActive ? '2px solid #e63946' : '1px solid #e5e5e5',
                boxShadow: isActive ? '0 0 8px rgba(230,57,70,0.3)' : 'none',
              }}>
                {PHASE_ICONS[p]?.[0] ?? '•'}
              </div>
              {i < PHASE_STEPS.length - 1 && (
                <div style={{
                  width: '16px', height: '2px',
                  background: isPast ? '#22c55e' : '#e5e5e5',
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
      <span style={{ fontSize: '12px', color: '#6b7280' }}>
        Turn {turn}
      </span>
    </div>
  );
}

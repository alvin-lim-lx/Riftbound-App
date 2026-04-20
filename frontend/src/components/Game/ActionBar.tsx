/**
 * ActionBar — Pass turn, settings, etc.
 */
import React from 'react';
import type { Phase } from '../../shared/types';

interface Props {
  myTurn: boolean;
  phase: Phase;
  onPass: () => void;
}

export function ActionBar({ myTurn, phase, onPass }: Props) {
  const showPass = myTurn && ['FirstMain', 'SecondMain'].includes(phase);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: '12px',
      padding: '10px 20px',
      background: '#ffffff',
      borderTop: '1px solid #e5e5e5',
    }}>
      {showPass && (
        <button
          onClick={onPass}
          style={{
            padding: '10px 36px',
            background: '#e63946',
            border: 'none',
            borderRadius: '6px',
            color: 'white',
            fontWeight: 700,
            fontSize: '14px',
            cursor: 'pointer',
            letterSpacing: '0.5px',
            transition: 'all 0.15s ease',
            boxShadow: '0 2px 8px rgba(230,57,70,0.3)',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-1px)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
        >
          Pass Turn
        </button>
      )}
      {!myTurn && (
        <span style={{ color: '#6b7280', fontSize: '13px', fontStyle: 'italic' }}>
          Waiting for opponent...
        </span>
      )}
    </div>
  );
}

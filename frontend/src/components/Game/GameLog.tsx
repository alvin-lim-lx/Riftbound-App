/**
 * GameLog - scrolling log of game events.
 */
import React, { useRef, useEffect } from 'react';

interface Props {
  messages: string[];
}

export function GameLog({ messages }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span>Game Log</span>
        <span style={styles.count}>{messages.length}</span>
      </div>
      <div ref={ref} style={styles.messages}>
        {messages.map((msg, i) => (
          <div key={i} style={styles.message}>
            {msg}
          </div>
        ))}
        {messages.length === 0 && (
          <div style={styles.empty}>
            Game events and AI actions will appear here.
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '9px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(2,6,23,0.74)',
    border: '1px solid rgba(148,163,184,0.14)',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '10px',
    fontWeight: 900,
    color: '#cbd5e1',
    textTransform: 'uppercase',
    letterSpacing: '1.2px',
    marginBottom: '8px',
    flexShrink: 0,
  },
  count: {
    color: '#94a3b8',
    background: 'rgba(148,163,184,0.12)',
    borderRadius: '999px',
    padding: '1px 7px',
    letterSpacing: 0,
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minHeight: 0,
  },
  message: {
    fontSize: '11px',
    color: '#e2e8f0',
    lineHeight: 1.35,
    padding: '6px 7px',
    background: 'rgba(15,23,42,0.86)',
    border: '1px solid rgba(148,163,184,0.1)',
    borderRadius: '6px',
  },
  empty: {
    color: '#64748b',
    fontStyle: 'italic',
    fontSize: '11px',
    lineHeight: 1.4,
    padding: '8px',
  },
};

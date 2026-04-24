/**
 * GameLog — scrolling log of game events
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
    <div style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column', background: '#fafafa', overflow: 'hidden' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', flexShrink: 0 }}>
        Game Log
      </div>
      <div ref={ref} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', minHeight: 0 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ fontSize: '11px', color: '#4b5563', lineHeight: 1.4 }}>
            {msg}
          </div>
        ))}
        {messages.length === 0 && (
          <div style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '11px' }}>No events yet.</div>
        )}
      </div>
    </div>
  );
}

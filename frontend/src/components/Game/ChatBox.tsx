/**
 * ChatBox - compact player chat. De-emphasized for AI games.
 */
import React, { useRef, useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { gameService } from '../../services/gameService';

interface Props {
  playerId: string;
  opponentName: string;
  compact?: boolean;
}

export function ChatBox({ opponentName, compact = false }: Props) {
  const store = useGameStore();
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAI = opponentName.toLowerCase().includes('player 2') || opponentName.toLowerCase().includes('ai');

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [store.chatMessages]);

  const send = () => {
    const msg = text.trim();
    if (!msg) return;
    gameService.sendChat(msg);
    setText('');
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ ...styles.container, opacity: compact ? 0.9 : 1 }}>
      <div style={styles.header}>
        <span>{isAI ? 'AI Match' : 'Chat'}</span>
        {isAI && <span style={styles.aiHint}>Log first</span>}
      </div>

      <div style={styles.messages}>
        {store.chatMessages.length === 0 && (
          <div style={styles.empty}>
            {isAI ? 'Chat is minimized for AI games.' : 'No messages yet.'}
          </div>
        )}
        {store.chatMessages.map(msg => (
          <div key={msg.id} style={{
            ...styles.message,
            alignSelf: msg.sender === 'player' ? 'flex-end' : msg.sender === 'opponent' ? 'flex-start' : 'center',
          }}>
            <span style={{
              ...styles.sender,
              color: msg.sender === 'player' ? '#22c55e' : msg.sender === 'opponent' ? '#ef4444' : '#94a3b8',
            }}>
              {msg.sender === 'player' ? 'You' : msg.sender === 'opponent' ? opponentName : 'System'}
            </span>
            <div style={{
              ...styles.bubble,
              background: msg.sender === 'player'
                ? 'rgba(34,197,94,0.14)'
                : msg.sender === 'opponent'
                ? 'rgba(239,68,68,0.14)'
                : 'rgba(148,163,184,0.08)',
              borderColor: msg.sender === 'player'
                ? 'rgba(34,197,94,0.28)'
                : msg.sender === 'opponent'
                ? 'rgba(239,68,68,0.28)'
                : 'rgba(148,163,184,0.14)',
            }}>
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={styles.inputRow}>
        <input
          style={styles.input}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder={isAI ? 'Optional note...' : 'Send a message...'}
          maxLength={200}
        />
        <button style={styles.sendBtn} onClick={send}>Send</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    height: '100%',
    background: 'rgba(2,6,23,0.72)',
    borderRadius: '8px',
    border: '1px solid rgba(148,163,184,0.14)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '10px',
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '1.2px',
    color: '#cbd5e1',
    padding: '8px 10px 5px',
    flexShrink: 0,
  },
  aiHint: {
    color: '#64748b',
    fontSize: '9px',
    letterSpacing: '0.8px',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '4px 10px',
    minHeight: 0,
  },
  empty: {
    color: '#64748b',
    fontSize: '11px',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: '8px',
    lineHeight: 1.4,
  },
  message: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    maxWidth: '85%',
  },
  sender: {
    fontSize: '9px',
    fontWeight: 800,
    paddingLeft: '4px',
  },
  bubble: {
    padding: '5px 8px',
    borderRadius: '6px',
    border: '1px solid',
    fontSize: '11px',
    color: '#e8e8e8',
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },
  inputRow: {
    display: 'flex',
    gap: '6px',
    padding: '7px 8px',
    flexShrink: 0,
    borderTop: '1px solid rgba(148,163,184,0.1)',
  },
  input: {
    flex: 1,
    background: 'rgba(15,23,42,0.9)',
    border: '1px solid rgba(148,163,184,0.18)',
    borderRadius: '5px',
    color: '#e8e8e8',
    fontSize: '12px',
    padding: '6px 8px',
    outline: 'none',
    minWidth: 0,
  },
  sendBtn: {
    background: 'rgba(34,197,94,0.18)',
    border: '1px solid rgba(34,197,94,0.36)',
    borderRadius: '5px',
    color: '#86efac',
    fontSize: '11px',
    fontWeight: 800,
    padding: '6px 10px',
    cursor: 'pointer',
    flexShrink: 0,
  },
};

/**
 * ChatBox — player vs opponent chat panel
 */
import React, { useRef, useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { gameService } from '../../services/gameService';

interface ChatMessage {
  id: string;
  sender: 'player' | 'opponent' | 'system';
  text: string;
  timestamp: Date;
}

interface Props {
  playerId: string;
  opponentName: string;
}

export function ChatBox({ playerId, opponentName }: Props) {
  const store = useGameStore();
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

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
    <div style={styles.container}>
      <div style={styles.header}>CHAT</div>

      <div style={styles.messages}>
        {store.chatMessages.length === 0 && (
          <div style={styles.empty}>No messages yet.</div>
        )}
        {store.chatMessages.map(msg => (
          <div key={msg.id} style={{
            ...styles.message,
            alignSelf: msg.sender === 'player' ? 'flex-end' : msg.sender === 'opponent' ? 'flex-start' : 'center',
          }}>
            <span style={{
              ...styles.sender,
              color: msg.sender === 'player' ? '#22c55e' : msg.sender === 'opponent' ? '#ef4444' : '#888',
            }}>
              {msg.sender === 'player' ? 'You' : msg.sender === 'opponent' ? opponentName : 'System'}
            </span>
            <div style={{
              ...styles.bubble,
              background: msg.sender === 'player'
                ? 'rgba(34,197,94,0.15)'
                : msg.sender === 'opponent'
                ? 'rgba(239,68,68,0.15)'
                : 'rgba(255,255,255,0.05)',
              borderColor: msg.sender === 'player'
                ? 'rgba(34,197,94,0.3)'
                : msg.sender === 'opponent'
                ? 'rgba(239,68,68,0.3)'
                : 'rgba(255,255,255,0.08)',
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
          placeholder="Send a message..."
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
    background: 'rgba(0,0,0,0.5)',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  header: {
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    color: '#666',
    padding: '6px 10px 4px',
    flexShrink: 0,
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
    color: '#555',
    fontSize: '11px',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: '8px',
  },
  message: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    maxWidth: '85%',
  },
  sender: {
    fontSize: '9px',
    fontWeight: 700,
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
    padding: '6px 8px',
    flexShrink: 0,
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  input: {
    flex: 1,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '4px',
    color: '#e8e8e8',
    fontSize: '12px',
    padding: '5px 8px',
    outline: 'none',
  },
  sendBtn: {
    background: 'rgba(34,197,94,0.2)',
    border: '1px solid rgba(34,197,94,0.4)',
    borderRadius: '4px',
    color: '#22c55e',
    fontSize: '11px',
    fontWeight: 700,
    padding: '5px 10px',
    cursor: 'pointer',
    flexShrink: 0,
  },
};

/**
 * LobbyPage — create/join game lobby
 */
import React, { useState, useEffect } from 'react';
import { gameService } from '../../services/gameService';
import { useGameStore } from '../../store/gameStore';
import { useAuth } from '../../contexts/AuthContext';
import { authFetch } from '../../services/authService';

const API = 'http://localhost:3001/api';

interface Props {
  playerId: string;
  playerName: string;
  onGameStart: () => void;
  onDeckBuilder: () => void;
}

export function LobbyPage({ playerId, playerName, onGameStart, onDeckBuilder }: Props) {
  const { logout, user } = useAuth();
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');
  const [lobbyId, setLobbyId] = useState<string>('');
  const [joinCode, setJoinCode] = useState<string>('');
  const [isAI, setIsAI] = useState(false);
  const [error, setError] = useState<string>('');
  const [myDecks, setMyDecks] = useState<any[]>([]);
  const syncDeckToStore = useGameStore(s => s.setSelectedDeckId);
  const storeDeckId = useGameStore(s => s.selectedDeckId);
  const [selectedDeckId, setSelectedDeckId] = useState<string>(storeDeckId ?? '');

  function fetchDecks() {
    authFetch(`${API}/decks`)
      .then(r => r.json())
      .then(data => setMyDecks(data.decks ?? []))
      .catch(() => {});
  }

  useEffect(() => { fetchDecks(); }, []);

  // Auto-select first deck once loaded
  useEffect(() => {
    if (myDecks.length > 0 && !selectedDeckId) {
      const firstDeckId = myDecks[0].id;
      setSelectedDeckId(firstDeckId);
      useGameStore.getState().setSelectedDeckId(firstDeckId);
    }
  }, [myDecks]);

  useEffect(() => {
    const onLobbyCreated = (data: any) => {
      setLobbyId(data.lobby.id);
      // If AI was requested, start_vs_ai already started the game
      // Otherwise just show lobby code waiting for opponent
    };

    const onLobbyUpdate = (data: any) => {
      if (data.lobby.status === 'starting') {
        onGameStart();
      }
    };

    const handleGameStart = (_data: any) => {
      onGameStart();
    };

    gameService.on('lobby_created', onLobbyCreated);
    gameService.on('lobby_update', onLobbyUpdate);
    gameService.on('game_start', handleGameStart);

    return () => {
      gameService.off('lobby_created', onLobbyCreated);
      gameService.off('lobby_update', onLobbyUpdate);
      gameService.off('game_start', handleGameStart);
    };
  }, [onGameStart]);

  const handleCreate = () => {
    setError('');
    setIsAI(false);
    fetch(`${API}/lobbies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, playerName, deckId: selectedDeckId || null }),
    })
      .then(r => r.json())
      .then(data => {
        setLobbyId(data.lobby.id);
        setMode('create');
      })
      .catch(() => setError('Failed to create lobby. Is the server running?'));
  };

  const handlePlayAI = () => {
    setError('');
    // Ensure a deck is selected (auto-select first if none)
    const deckId = useGameStore.getState().selectedDeckId;
    if (!deckId) {
      if (myDecks.length > 0) {
        const firstDeckId = myDecks[0].id;
        setSelectedDeckId(firstDeckId);
        useGameStore.getState().setSelectedDeckId(firstDeckId);
      } else {
        setError('No deck selected. Please create or import a deck first.');
        return;
      }
    }
    const confirmedDeckId = useGameStore.getState().selectedDeckId;
    console.log('[DEBUG] handlePlayAI selectedDeckId from store:', confirmedDeckId);
    gameService.startVsAI(confirmedDeckId);
    setMode('create');
  };

  const handleJoin = () => {
    if (!joinCode.trim()) return;
    setError('');
    setIsAI(false);
    fetch(`${API}/lobbies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, playerName, deckId: selectedDeckId || null }),
    })
      .then(r => r.json())
      .then(data => {
        const newLobbyId = data.lobby.id;
        return fetch(`${API}/lobbies/${newLobbyId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId, deckId: selectedDeckId || null }),
        }).then(() => newLobbyId);
      })
      .then(() => {
        setMode('create');
      })
      .catch(() => setError('Failed to join lobby. Check the code and try again.'));
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>⚔️ Riftbound</h1>
            <p style={styles.subtitle}>League of Legends Trading Card Game</p>
          </div>
          {user && (
            <div style={styles.userBadge}>
              <span style={styles.username}>{user.username}</span>
              <button style={styles.logoutBtn} onClick={logout}>Sign Out</button>
            </div>
          )}
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {mode === 'menu' && (
          <div style={styles.menu}>
            <button style={styles.btn} onClick={handleCreate}>
              🆕 Create Game
            </button>
            <button style={styles.btnSecondary} onClick={handlePlayAI}>
              🤖 Play vs AI
            </button>
            <button style={styles.btnSecondary} onClick={() => setMode('join')}>
              🔗 Join Game
            </button>
            <hr style={styles.divider} />
            <div style={styles.deckSelect}>
              <label style={styles.deckLabel}>Your Deck</label>
              <select
                style={styles.deckSelectInput}
                value={selectedDeckId}
                onChange={e => {
                  setSelectedDeckId(e.target.value);
                  syncDeckToStore(e.target.value);
                }}
              >
                {myDecks.length === 0 && <option value="">No decks (random)</option>}
                {myDecks.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.cardIds.length} cards)</option>
                ))}
              </select>
              <button style={styles.buildDeckBtn} onClick={onDeckBuilder}>
                ⚔️ Build Deck
              </button>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <div style={styles.waiting}>
            {isAI ? (
              <>
                <p style={styles.waitText}>Starting game vs AI...</p>
                <p style={styles.hint}>Please wait</p>
              </>
            ) : (
              <>
                <p style={styles.waitText}>Waiting for opponent...</p>
                <div style={styles.lobbyCode}>
                  <span style={styles.codeLabel}>Lobby Code:</span>
                  <span style={styles.code}>{lobbyId}</span>
                </div>
                <p style={styles.hint}>Share this code with a friend to join</p>
              </>
            )}
            <button style={styles.btnSecondary} onClick={() => setMode('menu')}>
              ← Back
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div style={styles.joinSection}>
            <input
              style={styles.input}
              placeholder="Enter lobby code..."
              value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
            />
            <button style={styles.btn} onClick={handleJoin}>
              Join
            </button>
            <button style={styles.btnSecondary} onClick={() => setMode('menu')}>
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100vh', background: 'linear-gradient(135deg, #0f0f23, #1a1a2e)',
  },
  card: {
    background: 'rgba(30,30,60,0.95)',
    borderRadius: '20px', padding: '48px',
    border: '1px solid rgba(255,255,255,0.1)',
    textAlign: 'center' as const, maxWidth: '420px', width: '90%',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: '32px',
  },
  userBadge: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px',
  },
  username: {
    fontSize: '13px', color: '#fbbf24', fontWeight: 600,
  },
  logoutBtn: {
    fontSize: '11px', color: '#6b7280', background: 'none', border: 'none',
    cursor: 'pointer', textDecoration: 'underline', padding: 0,
  },
  title: { fontSize: '36px', fontWeight: 800, color: '#fbbf24', margin: '0 0 4px', textShadow: '0 0 20px rgba(251,191,36,0.3)' },
  subtitle: { fontSize: '14px', color: '#6b7280', margin: '0' },
  error: { color: '#f87171', fontSize: '13px', marginBottom: '16px' },
  menu: { display: 'flex', flexDirection: 'column' as const, gap: '12px' },
  btn: {
    padding: '14px 32px', background: 'linear-gradient(135deg, #b45309, #d97706)',
    border: 'none', borderRadius: '10px', color: 'white', fontWeight: 700,
    fontSize: '16px', cursor: 'pointer', transition: 'all 0.15s ease',
    boxShadow: '0 4px 16px rgba(217,119,6,0.3)',
  },
  btnSecondary: {
    padding: '12px 32px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '10px', color: '#d1d5db', fontWeight: 600, fontSize: '14px',
    cursor: 'pointer', transition: 'all 0.15s ease',
  },
  waiting: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '16px' },
  waitText: { fontSize: '18px', color: '#d1d5db' },
  lobbyCode: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '4px' },
  codeLabel: { fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px' },
  code: { fontSize: '24px', fontWeight: 800, color: '#fbbf24', letterSpacing: '2px' },
  hint: { fontSize: '12px', color: '#6b7280' },
  joinSection: { display: 'flex', flexDirection: 'column' as const, gap: '12px' },
  input: {
    padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px', color: 'white', fontSize: '14px', outline: 'none', textAlign: 'center',
  },
  divider: { border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '8px 0' },
  deckSelect: { display: 'flex', flexDirection: 'column' as const, gap: '8px', marginTop: '4px' },
  deckLabel: { fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '1px' },
  deckSelectInput: {
    padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px', color: 'white', fontSize: '14px', width: '100%',
  },
  buildDeckBtn: {
    padding: '8px 12px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px', color: '#fbbf24', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
  },
};

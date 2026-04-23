/**
 * App — Frontend entry point
 */
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GamePage } from './components/Game/GamePage';
import { LobbyPage } from './components/UI/LobbyPage';
import { DeckBuilderPage } from './components/UI/DeckBuilderPage';
import { LoginPage } from './components/UI/LoginPage';
import { RegisterPage } from './components/UI/RegisterPage';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { gameService } from './services/gameService';
import { useGameStore } from './store/gameStore';
import { randomId } from './utils/helpers';
import './styles.css';

function AppInner() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [view, setView] = useState<'lobby' | 'game' | 'deckBuilder'>('lobby');
  // When logged in, use the user.id from JWT as playerId.
  // When not logged in, use a random session ID (anonymous play).
  const [playerId] = useState<string>('');
  const [effectivePlayerId, setEffectivePlayerId] = useState<string>('');
  const [playerName, setPlayerName] = useState<string>('');
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [connected, setConnected] = useState(false);
  const setPlayerIdStore = useGameStore(s => s.setPlayerId);

  // Derive effective playerId and playerName from auth state
  useEffect(() => {
    if (isAuthenticated && user) {
      setEffectivePlayerId(user.id);
      setPlayerName(user.username);
    } else {
      // Anonymous: use sessionStorage to persist across refreshes
      const stored = sessionStorage.getItem('rb_pid') ?? randomId();
      sessionStorage.setItem('rb_pid', stored);
      setEffectivePlayerId(stored);
      setPlayerName(`Player_${stored.slice(0, 4)}`);
    }
  }, [isAuthenticated, user]);

  // Connect to game WebSocket
  useEffect(() => {
    if (!effectivePlayerId) return;
    setConnected(false);
    gameService.connect(effectivePlayerId)
      .then(() => {
        setPlayerIdStore(effectivePlayerId);
        setConnected(true);
      })
      .catch(err => console.error('Connection failed:', err));
    return () => gameService.disconnect();
  }, [effectivePlayerId]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#9ca3af' }}>
        Loading…
      </div>
    );
  }

  // Not authenticated — show auth pages
  if (!isAuthenticated) {
    if (authView === 'login') {
      return (
        <LoginPage
          onSwitchToRegister={() => setAuthView('register')}
        />
      );
    } else {
      return (
        <RegisterPage
          onSwitchToLogin={() => setAuthView('login')}
        />
      );
    }
  }

  // Authenticated — main app
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      {!connected && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#9ca3af' }}>
          Connecting to game server…
        </div>
      )}
      {connected && view === 'lobby' && (
        <LobbyPage
          playerId={effectivePlayerId}
          playerName={playerName}
          onGameStart={() => setView('game')}
          onDeckBuilder={() => setView('deckBuilder')}
        />
      )}
      {connected && view === 'deckBuilder' && (
        <DeckBuilderPage
          playerId={effectivePlayerId}
          onBack={() => setView('lobby')}
          onDeckSaved={(deckId) => {
            useGameStore.getState().setSelectedDeckId(deckId);
          }}
        />
      )}
      {connected && view === 'game' && (
        <GamePage />
      )}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

/**
 * RegisterPage — username/password registration
 */
import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface Props {
  onSwitchToLogin: () => void;
}

export function RegisterPage({ onSwitchToLogin }: Props) {
  const { register } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Username and password are required');
      return;
    }
    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    const result = await register(username.trim(), password);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Registration failed');
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>⚔️ Riftbound</h1>
        <p style={styles.subtitle}>Create your account</p>

        {error && <p style={styles.error}>{error}</p>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            style={styles.input}
            type="text"
            placeholder="Username (3+ characters)"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Password (6+ characters)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p style={styles.switchText}>
          Already have an account?{' '}
          <button style={styles.switchBtn} onClick={onSwitchToLogin}>
            Sign in
          </button>
        </p>
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
    background: 'rgba(30,30,60,0.95)', borderRadius: '20px', padding: '48px',
    border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' as const,
    maxWidth: '400px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  title: { fontSize: '36px', fontWeight: 800, color: '#fbbf24', margin: '0 0 8px', textShadow: '0 0 20px rgba(251,191,36,0.3)' },
  subtitle: { fontSize: '14px', color: '#6b7280', margin: '0 0 32px' },
  error: { color: '#f87171', fontSize: '13px', marginBottom: '16px' },
  form: { display: 'flex', flexDirection: 'column' as const, gap: '12px' },
  input: {
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px', color: 'white', fontSize: '14px', outline: 'none',
    width: '100%', boxSizing: 'border-box',
  },
  btn: {
    padding: '14px 32px',
    background: 'linear-gradient(135deg, #b45309, #d97706)',
    border: 'none', borderRadius: '10px', color: 'white', fontWeight: 700,
    fontSize: '16px', cursor: 'pointer', transition: 'all 0.15s ease',
    boxShadow: '0 4px 16px rgba(217,119,6,0.3)',
    marginTop: '8px',
  },
  switchText: { fontSize: '13px', color: '#6b7280', marginTop: '24px' },
  switchBtn: {
    background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer',
    fontSize: '13px', textDecoration: 'underline', padding: 0,
  },
};

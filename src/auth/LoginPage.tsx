import { useState } from 'react';
import { useAuth } from './AuthContext';
import { Logo } from '../components/Logo';
import { isConfigured } from '../data/supabase';

export function LoginPage() {
  const { login, preview } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password || (preview ? 'preview' : ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <Logo />
        <h1>Laboratorul de Culoare</h1>
        <div className="by">by Diana Avram · Agenda</div>
        {!isConfigured && !preview && (
          <div className="notice danger small">Aplicația nu este configurată: lipsesc datele Supabase. Vezi docs/INSTALARE.md.</div>
        )}
        {preview && (
          <div className="notice warn small">Mod previzualizare locală (fără server). Scrieți „diana” sau „colega”, fără parolă.</div>
        )}
        <label className="field">
          <span>Utilizator</span>
          <input className="input" autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ex.: diana" />
        </label>
        <label className="field">
          <span>Parolă</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="notice danger small">{error}</div>}
        <button className="btn big primary" disabled={busy}>{busy ? 'Se conectează…' : 'Intră în agendă'}</button>
        <div className="tiny muted" style={{ textAlign: 'center' }}>Prima conectare pe un dispozitiv necesită internet. După aceea agenda funcționează și offline.</div>
      </form>
    </div>
  );
}

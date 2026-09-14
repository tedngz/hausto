// Email and password, because an operator signs in once at the start of a shift
// on a machine we control. A magic link would put a second surface (their
// inbox) between them and the queue for no gain.

import { useState } from 'react';
import { supabase } from './supabase';

export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  };

  return (
    <div className="wrap" style={{ maxWidth: 320, paddingTop: 80 }}>
      <h1 style={{ fontSize: 18 }}>Hausto ops</h1>
      <form onSubmit={submit} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button className="primary" disabled={busy || !email || !password}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}

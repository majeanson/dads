import { useEffect, useState } from 'react';

type Health = { ok: boolean; db: boolean };

/**
 * M0 shell. It renders the health of the stack it sits on and nothing else —
 * the room, the prompt, the board and the table arrive in M2-M6. Its job today
 * is to prove the Worker, D1 and the built client are one working system.
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <main style={{ padding: '2rem', maxWidth: '40rem', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>dads</h1>
      <p style={{ color: 'var(--ink-dim)', marginTop: 0 }}>
        Somewhere to talk about it, and a table to sit at while you do.
      </p>
      <p data-testid="health">
        {error
          ? `stack: unreachable (${error})`
          : health
            ? `stack: worker ${health.ok ? 'up' : 'down'}, d1 ${health.db ? 'up' : 'down'}`
            : 'stack: checking…'}
      </p>
    </main>
  );
}

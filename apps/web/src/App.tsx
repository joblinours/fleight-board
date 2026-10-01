import { type HealthResponse, HealthResponseSchema, PROTOCOL_VERSION } from '@fleight/protocol';
import { useEffect, useState } from 'react';

type ApiState = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'error' };

export function App() {
  const [api, setApi] = useState<ApiState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/ready', { signal: controller.signal })
      .then((response) => response.json())
      .then((body) => setApi({ kind: 'ok', health: HealthResponseSchema.parse(body) }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setApi({ kind: 'error' });
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="home">
      <h1>Fleight Board</h1>
      <p>Whiteboard collaboratif temps réel — Phase 0 (Proof of Concept).</p>
      <dl>
        <dt>Protocole client</dt>
        <dd>v{PROTOCOL_VERSION}</dd>
        <dt>API</dt>
        <dd>
          {api.kind === 'loading' && 'connexion…'}
          {api.kind === 'error' && 'injoignable'}
          {api.kind === 'ok' &&
            `${api.health.status === 'ok' ? 'prête' : 'base de données indisponible'} (protocole v${api.health.protocolVersion})`}
        </dd>
      </dl>
    </main>
  );
}

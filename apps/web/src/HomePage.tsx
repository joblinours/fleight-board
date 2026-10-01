import { type HealthResponse, HealthResponseSchema, PROTOCOL_VERSION } from '@fleight/protocol';
import { type FormEvent, useEffect, useState } from 'react';
import { MILESTONES } from './milestones';

type ApiState = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'error' };

const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function HomePage() {
  const [api, setApi] = useState<ApiState>({ kind: 'loading' });
  const [boardName, setBoardName] = useState('');

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

  const openBoard = (event: FormEvent) => {
    event.preventDefault();
    if (BOARD_ID.test(boardName)) window.location.hash = `#/board/${boardName}`;
  };

  const apiReady = api.kind === 'ok' && api.health.status === 'ok';

  return (
    <main className="home">
      <h1>Fleight Board</h1>
      <p>Whiteboard collaboratif temps réel — Phase 0 (Proof of Concept).</p>
      <dl>
        <dt>Protocole client</dt>
        <dd>v{PROTOCOL_VERSION}</dd>
        <dt>API</dt>
        <dd className={apiReady ? 'ok' : 'ko'}>
          {api.kind === 'loading' && 'connexion…'}
          {api.kind === 'error' && 'injoignable — lancer ./scripts/dev.sh'}
          {api.kind === 'ok' &&
            `${api.health.status === 'ok' ? 'prête' : 'base de données indisponible'} (protocole v${api.health.protocolVersion})`}
        </dd>
      </dl>

      <form className="home-open" onSubmit={openBoard}>
        <label htmlFor="board-name">Ouvrir un board collaboratif</label>
        <div>
          <input
            id="board-name"
            value={boardName}
            placeholder="nom-du-board"
            pattern="[A-Za-z0-9_\-]{1,64}"
            onChange={(event) => setBoardName(event.target.value.trim())}
          />
          <button type="submit" disabled={!BOARD_ID.test(boardName)}>
            Ouvrir
          </button>
        </div>
      </form>

      <h2>Tests par jalon</h2>
      <ol className="milestones">
        {MILESTONES.map((milestone) => (
          <li key={milestone.id}>
            <div className="milestone-head">
              <span className="milestone-id">{milestone.id}</span>
              <strong>{milestone.title}</strong>
              <a href={milestone.href}>{milestone.linkLabel} →</a>
            </div>
            <p>{milestone.summary}</p>
            {(milestone.needsApi || milestone.multiDevice) && (
              <p className="milestone-tags">
                {milestone.needsApi && <span>API requise</span>}
                {milestone.multiDevice && <span>Plusieurs appareils</span>}
              </p>
            )}
            <ul>
              {milestone.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </main>
  );
}

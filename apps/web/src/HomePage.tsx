import { type HealthResponse, HealthResponseSchema, PROTOCOL_VERSION } from '@fleight/protocol';
import { useEffect, useState } from 'react';
import { logout, useSession } from './auth/session';
import { GuestJoinForm } from './board/AccessPages';
import { BoardsSection } from './boards/BoardsSection';
import { MILESTONES } from './milestones';

type ApiState = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'error' };

export function HomePage() {
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

  const apiReady = api.kind === 'ok' && api.health.status === 'ok';

  return (
    <main className="home">
      <AccountBar />
      <h1>Fleight Board</h1>
      <p>Whiteboard collaboratif temps réel — Phase 1 (Core MVP).</p>
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

      <HomeBoards />

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

/** Utilisateur connecté et accès au compte, ou lien de connexion. */
function AccountBar() {
  const session = useSession();
  if (session.status === 'loading' || session.status === 'offline') return null;
  if (session.status === 'anonymous') {
    return (
      <p className="home-account">
        <a href="#/login">Se connecter</a> · <a href="#/register">Demander un compte</a>
      </p>
    );
  }
  return (
    <p className="home-account">
      <span>
        Connecté : <strong>{session.user.displayName}</strong>
      </span>
      <a href="#/account">Mon compte</a>
      {session.user.role === 'admin' && <a href="#/admin">Administration</a>}
      <button type="button" className="link" onClick={() => void logout()}>
        Se déconnecter
      </button>
    </p>
  );
}

/** Whiteboards de l'utilisateur connecté ; invitation à se connecter sinon. */
function HomeBoards() {
  const session = useSession();
  if (session.status === 'authenticated') return <BoardsSection />;
  if (session.status === 'anonymous') {
    return (
      <>
        <p className="home-login">
          <a href="#/login">Connectez-vous</a> pour créer et rejoindre des whiteboards.
        </p>
        <GuestJoinForm />
      </>
    );
  }
  return null;
}

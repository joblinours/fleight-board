import { type HealthResponse, HealthResponseSchema, PROTOCOL_VERSION } from '@fleight/protocol';
import { useEffect, useState } from 'react';
import { useSession } from './auth/session';
import { GuestJoinForm } from './board/AccessPages';
import { BoardsSection } from './boards/BoardsSection';
import { AppShell, Logo, PageHeader } from './layout/AppShell';
import { MILESTONES } from './milestones';
import { Badge, Spinner } from './ui/components';
import { Icon, type IconName } from './ui/Icon';

/** Accueil : tableau de bord une fois connecté, page de présentation sinon. */
export function HomePage() {
  const session = useSession();
  if (session.status === 'loading') {
    return (
      <div className="page-loading full">
        <Spinner />
      </div>
    );
  }
  if (session.status === 'authenticated') {
    return (
      <AppShell>
        <BoardsSection />
      </AppShell>
    );
  }
  return <LandingPage offline={session.status === 'offline'} />;
}

const FEATURES: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: 'users',
    title: 'Temps réel',
    text: 'Curseurs, présence et modifications partagées instantanément.',
  },
  {
    icon: 'pen',
    title: 'Pensé pour l’Apple Pencil',
    text: 'Tracé fluide sensible à la pression, rejet de la paume.',
  },
  {
    icon: 'shield',
    title: 'Auto-hébergé',
    text: 'Vos données restent chez vous : rôles, accès et audit complets.',
  },
];

/** Présentation et entrées : connexion, demande de compte, invité. */
function LandingPage({ offline }: { offline: boolean }) {
  return (
    <div className="landing">
      <header className="landing-header">
        <Logo />
        <nav>
          <a href="#/register" className="btn btn-ghost">
            Demander un compte
          </a>
          <a href="#/login" className="btn btn-primary">
            Se connecter
          </a>
        </nav>
      </header>
      <main className="landing-main">
        <section className="landing-hero">
          <Badge tone="primary" icon="sparkles">
            Whiteboard collaboratif
          </Badge>
          <h1>
            Pensez, dessinez et construisez <span>ensemble</span>.
          </h1>
          <p>
            Fleight Board réunit dessin libre, schémas structurés et collaboration en temps réel,
            sur ordinateur comme sur iPad.
          </p>
          {offline && (
            <div className="alert alert-warning">
              <Icon name="bell" size={16} />
              Le serveur est injoignable pour le moment.
            </div>
          )}
          <ul className="landing-features">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <span className="landing-feature-icon">
                  <Icon name={feature.icon} size={18} />
                </span>
                <div>
                  <strong>{feature.title}</strong>
                  <p>{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <aside className="card landing-card">
          <div className="card-body">
            <GuestJoinForm />
            <p className="landing-card-alt subtle">
              Vous avez un compte ? <a href="#/login">Connectez-vous</a> pour créer vos tableaux.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}

type ApiState = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'error' };

/** Jalons de développement : une fiche de test par étape, et l'état de l'API. */
export function MilestonesPage() {
  const [api, setApi] = useState<ApiState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/ready', { signal: controller.signal })
      .then((response) => response.json())
      .then((body) => setApi({ kind: 'ok', health: HealthResponseSchema.parse(body) }))
      .catch(() => {
        if (!controller.signal.aborted) setApi({ kind: 'error' });
      });
    return () => controller.abort();
  }, []);
  const ready = api.kind === 'ok' && api.health.status === 'ok';

  return (
    <AppShell>
      <div className="page">
        <PageHeader
          title="Jalons de test"
          subtitle="Une fiche par étape du plan d’implémentation, pour vérifier chaque livraison à la main."
          actions={
            <span className={`status-pill ${ready ? 'ok' : api.kind === 'loading' ? '' : 'ko'}`}>
              <span className="status-dot" />
              {api.kind === 'loading' && 'API…'}
              {api.kind === 'error' && 'API injoignable'}
              {api.kind === 'ok' &&
                `${ready ? 'API prête' : 'Base de données indisponible'} · protocole v${api.health.protocolVersion} (client v${PROTOCOL_VERSION})`}
            </span>
          }
        />
        <ol className="milestones">
          {[...MILESTONES].reverse().map((milestone) => (
            <li key={milestone.id} className="card milestone">
              <div className="milestone-head">
                <span className="milestone-id">{milestone.id}</span>
                <div>
                  <h3>{milestone.title}</h3>
                  <p className="muted">{milestone.summary}</p>
                </div>
                <a href={milestone.href} className="btn btn-secondary btn-sm">
                  {milestone.linkLabel}
                  <Icon name="chevronRight" size={15} />
                </a>
              </div>
              {(milestone.needsApi || milestone.multiDevice) && (
                <p className="milestone-tags">
                  {milestone.needsApi && <Badge>API requise</Badge>}
                  {milestone.multiDevice && <Badge tone="primary">Plusieurs appareils</Badge>}
                </p>
              )}
              <ol className="milestone-steps">
                {milestone.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </div>
    </AppShell>
  );
}

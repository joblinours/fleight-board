import { useEffect, useState } from 'react';
import { AdminPage } from './admin/AdminPage';
import { AdminAuditPage, AuditPage } from './audit/AuditPage';
import { AccountPage, LoginPage, nextRoute, RegisterPage } from './auth/AuthPages';
import { refreshSession, useSession } from './auth/session';
import { BenchPage } from './bench/BenchPage';
import { GuestJoinPage, GuestRoute } from './board/AccessPages';
import { BoardPage } from './board/BoardPage';
import { BoardRoute, JoinRoute } from './board/BoardRoute';
import { HomePage, MilestonesPage } from './HomePage';
import { InkPage } from './ink/InkPage';
import { Spinner, ToastRegion } from './ui/components';

/** Route courante, sans les paramètres (`#/login?next=…` → `/login`). */
function currentRoute(): string {
  return window.location.hash.replace(/^#/, '').split('?')[0] || '/';
}

/** Pages accessibles sans être connecté. */
const PUBLIC_ROUTES = new Set(['/', '/login', '/register', '/bench', '/ink', '/guest']);

/** Lien de partage `#/join/<CODE>`. */
const JOIN_ROUTE = /^\/join\/([A-Za-z0-9]{6})$/;

export function App() {
  const [route, setRoute] = useState(currentRoute);
  const session = useSession();

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    void refreshSession();
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Un lien de partage reste ouvert sans compte : on peut y entrer en invité.
  const isPublic = PUBLIC_ROUTES.has(route) || JOIN_ROUTE.test(route);
  const mustChangePassword =
    session.status === 'authenticated' && session.user.mustChangePassword && route !== '/account';

  // Redirections : connexion requise, ou mot de passe temporaire à changer.
  useEffect(() => {
    if (!isPublic && session.status === 'anonymous') {
      window.location.hash = `#/login?next=${encodeURIComponent(route)}`;
    } else if (mustChangePassword) {
      window.location.hash = '#/account';
    } else if (route === '/login' && session.status === 'authenticated') {
      // Juste connecté (ou déjà connecté) : page demandée avant la connexion.
      window.location.hash = `#${nextRoute()}`;
    }
  }, [isPublic, session.status, mustChangePassword, route]);

  return (
    <>
      <Routes route={route} />
      <ToastRegion />
    </>
  );
}

/** Page de la route courante. */
function Routes({ route }: { route: string }) {
  const session = useSession();
  const mustChangePassword =
    session.status === 'authenticated' && session.user.mustChangePassword && route !== '/account';

  switch (route) {
    case '/login':
      return <LoginPage />;
    case '/register':
      return <RegisterPage />;
    case '/bench':
      return <BenchPage />;
    case '/ink':
      return <InkPage />;
    case '/':
      return <HomePage />;
    case '/guest':
      return <GuestRoute />;
  }

  if (session.status === 'loading') {
    return (
      <div className="page-loading full">
        <Spinner />
      </div>
    );
  }
  if (session.status === 'offline') {
    return (
      <p className="page-status">API injoignable — lancer ./scripts/dev.sh, puis recharger.</p>
    );
  }
  const shareLink = route.match(JOIN_ROUTE);
  if (shareLink?.[1] && session.status === 'anonymous')
    return <GuestJoinPage code={shareLink[1]} />;
  if (session.status !== 'authenticated' || mustChangePassword) return null;

  const board = route.match(/^\/board\/([A-Za-z0-9_-]{1,64})$/);
  if (board?.[1]) return <BoardRoute key={board[1]} boardId={board[1]} />;
  if (shareLink?.[1]) return <JoinRoute key={shareLink[1]} code={shareLink[1]} />;
  const audit = route.match(/^\/audit\/([A-Za-z0-9_-]{1,64})$/);
  if (audit?.[1]) return <AuditPage key={audit[1]} boardId={audit[1]} />;

  switch (route) {
    case '/board':
      return <BoardPage />;
    case '/account':
      return <AccountPage />;
    case '/milestones':
      return <MilestonesPage />;
    case '/admin':
      return <AdminPage />;
    case '/admin/audit':
      return <AdminAuditPage />;
    default:
      return <HomePage />;
  }
}

import { useEffect, useState } from 'react';
import { AdminPage } from './admin/AdminPage';
import { AuditPage } from './audit/AuditPage';
import { AccountPage, LoginPage, nextRoute, RegisterPage } from './auth/AuthPages';
import { refreshSession, useSession } from './auth/session';
import { BenchPage } from './bench/BenchPage';
import { BoardPage } from './board/BoardPage';
import { HomePage } from './HomePage';
import { InkPage } from './ink/InkPage';

/** Route courante, sans les paramètres (`#/login?next=…` → `/login`). */
function currentRoute(): string {
  return window.location.hash.replace(/^#/, '').split('?')[0] || '/';
}

/** Pages accessibles sans être connecté. */
const PUBLIC_ROUTES = new Set(['/', '/login', '/register', '/bench', '/ink']);

export function App() {
  const [route, setRoute] = useState(currentRoute);
  const session = useSession();

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    void refreshSession();
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const isPublic = PUBLIC_ROUTES.has(route);
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
  }

  if (session.status === 'loading') return <p className="page-status">Chargement…</p>;
  if (session.status === 'offline') {
    return (
      <p className="page-status">API injoignable — lancer ./scripts/dev.sh, puis recharger.</p>
    );
  }
  if (session.status !== 'authenticated' || mustChangePassword) return null;

  const board = route.match(/^\/board\/([A-Za-z0-9_-]{1,64})$/);
  if (board?.[1]) return <BoardPage key={board[1]} boardId={board[1]} />;
  const audit = route.match(/^\/audit\/([A-Za-z0-9_-]{1,64})$/);
  if (audit?.[1]) return <AuditPage key={audit[1]} boardId={audit[1]} />;

  switch (route) {
    case '/board':
      return <BoardPage />;
    case '/account':
      return <AccountPage />;
    case '/admin':
      return <AdminPage />;
    default:
      return <HomePage />;
  }
}

import type { ReactNode } from 'react';
import { logout, useSession } from '../auth/session';
import { Avatar, Menu, MenuItem } from '../ui/components';
import { Icon, type IconName } from '../ui/Icon';

/** Logo : une feuille de board stylisée et le nom. */
export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="logo">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#logo-gradient)" />
        <path
          d="M9 22.5c2.2-5.6 4.6-8.4 7.2-8.4 2.3 0 2 3.9 4.3 3.9 1.3 0 2.3-1.4 2.9-3.2"
          fill="none"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx="10" cy="10.5" r="2.2" fill="#fff" />
      </svg>
      {!compact && (
        <span className="logo-text">
          Fleight<span>Board</span>
        </span>
      )}
    </span>
  );
}

/** Route courante, pour l'entrée active de la navigation. */
function currentPath(): string {
  return window.location.hash.replace(/^#/, '').split('?')[0] || '/';
}

function NavLink({
  href,
  icon,
  children,
  match,
}: {
  href: string;
  icon: IconName;
  children: ReactNode;
  /** Préfixes de route qui rendent l'entrée active. */
  match: (path: string) => boolean;
}) {
  const active = match(currentPath());
  return (
    <a href={href} className={`nav-link${active ? ' active' : ''}`} title={String(children)}>
      <Icon name={icon} size={18} />
      <span>{children}</span>
    </a>
  );
}

/** Menu du compte : profil, mot de passe, déconnexion. */
export function UserMenu({ placement = 'above' }: { placement?: 'above' | 'below' }) {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const { user } = session;
  return (
    <Menu
      align="start"
      placement={placement}
      trigger={(props) => (
        <button type="button" className="user-button" {...props}>
          <Avatar name={user.displayName} />
          <span className="user-button-text">
            <strong>{user.displayName}</strong>
            <small>{user.role === 'admin' ? 'Administrateur' : `@${user.username}`}</small>
          </span>
          <Icon name="chevronDown" size={16} />
        </button>
      )}
    >
      <div className="menu-label">{user.email ?? `@${user.username}`}</div>
      <MenuItem icon="user" href="#/account">
        Mon compte
      </MenuItem>
      {user.role === 'admin' && (
        <MenuItem icon="shield" href="#/admin">
          Administration
        </MenuItem>
      )}
      <div className="divider" />
      <MenuItem icon="logout" onClick={() => void logout()} danger>
        Se déconnecter
      </MenuItem>
    </Menu>
  );
}

/**
 * Cadre des pages de l'application : navigation latérale (repliée en icônes
 * sur tablette), en-tête de page et contenu.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const admin = session.status === 'authenticated' && session.user.role === 'admin';
  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="#/" className="sidebar-brand" aria-label="Accueil">
          <Logo />
        </a>
        <nav className="sidebar-nav">
          <div className="nav-section">Espace de travail</div>
          <NavLink
            href="#/"
            icon="grid"
            match={(path) => path === '/' || path.startsWith('/audit/')}
          >
            Tableaux
          </NavLink>
          {admin && (
            <>
              <div className="nav-section">Administration</div>
              <NavLink href="#/admin" icon="users" match={(path) => path === '/admin'}>
                Comptes
              </NavLink>
              <NavLink
                href="#/admin/audit"
                icon="history"
                match={(path) => path === '/admin/audit'}
              >
                Audit global
              </NavLink>
            </>
          )}
          <div className="nav-section">Développement</div>
          <NavLink href="#/milestones" icon="flask" match={(path) => path === '/milestones'}>
            Jalons de test
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <UserMenu />
        </div>
      </aside>
      <div className="shell-main">{children}</div>
    </div>
  );
}

/** En-tête d'une page : titre, sous-titre, actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {back && (
          <a href={back.href} className="page-back">
            <Icon name="arrowLeft" size={15} />
            {back.label}
          </a>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

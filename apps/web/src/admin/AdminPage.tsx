import {
  AuditLogResponseSchema,
  type AuditRecord,
  CreateUserRequestSchema,
  type PublicUser,
  TemporaryPasswordResponseSchema,
  type UpdateUserRequest,
  UsersResponseSchema,
} from '@fleight/protocol';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../auth/api';
import { useSession } from '../auth/session';
import { AppShell, PageHeader } from '../layout/AppShell';
import {
  Avatar,
  Badge,
  Button,
  copyText,
  EmptyState,
  Field,
  Menu,
  MenuItem,
  Modal,
} from '../ui/components';
import { Icon } from '../ui/Icon';

const STATUS_LABELS: Record<PublicUser['status'], string> = {
  active: 'Actif',
  disabled: 'Désactivé',
  pending: 'Demande en attente',
};

const EVENT_LABELS: Record<string, string> = {
  'auth.login': 'Connexion',
  'auth.login_failed': 'Échec de connexion',
  'auth.logout': 'Déconnexion',
  'auth.password_change': 'Changement de mot de passe',
  'user.request': 'Demande de compte',
  'user.create': 'Création de compte',
  'user.update': 'Modification de compte',
  'user.delete': 'Suppression de compte',
  'user.password_reset': 'Réinitialisation du mot de passe',
};

/** Administration des comptes (réservée aux Admins). */
export function AdminPage() {
  const session = useSession();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [events, setEvents] = useState<AuditRecord[]>([]);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  /** Mot de passe temporaire à transmettre, affiché une seule fois. */
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, audit] = await Promise.all([
        api('/admin/users').then((data) => UsersResponseSchema.parse(data).users),
        api('/admin/audit?limit=50&scope=accounts').then(
          (data) => AuditLogResponseSchema.parse(data).entries,
        ),
      ]);
      setUsers(list);
      setEvents(audit);
    } catch (error) {
      setMessage({ kind: 'error', text: describe(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: () => Promise<unknown>, done?: string) => {
    setMessage(null);
    try {
      await action();
      if (done) setMessage({ kind: 'info', text: done });
    } catch (error) {
      setMessage({ kind: 'error', text: describe(error) });
    }
    await load();
  };

  const update = (user: PublicUser, changes: UpdateUserRequest, done: string) =>
    act(() => api(`/admin/users/${user.id}`, { method: 'PATCH', body: changes }), done);

  const resetPassword = (user: PublicUser) =>
    act(async () => {
      const result = TemporaryPasswordResponseSchema.parse(
        await api(`/admin/users/${user.id}/reset-password`, { method: 'POST' }),
      );
      setSecret({ username: user.username, password: result.temporaryPassword });
    });

  const remove = (user: PublicUser) => {
    if (!window.confirm(`Supprimer définitivement le compte « ${user.username} » ?`)) return;
    void act(
      () => api(`/admin/users/${user.id}`, { method: 'DELETE' }),
      `Compte ${user.username} supprimé`,
    );
  };

  if (session.status !== 'authenticated') return null;
  if (session.user.role !== 'admin') {
    return (
      <AppShell>
        <div className="page">
          <EmptyState icon="shield" title="Réservé aux administrateurs" />
        </div>
      </AppShell>
    );
  }
  const self = session.user.id;
  const pending = users.filter(({ status }) => status === 'pending');
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  const accounts = users.filter(({ status }) => status !== 'pending');

  return (
    <AppShell>
      <div className="page">
        <PageHeader
          title="Comptes"
          subtitle={`${accounts.length} compte${accounts.length > 1 ? 's' : ''} · validation des demandes, rôles et mots de passe.`}
          actions={
            <>
              <a href="#/admin/audit" className="btn btn-secondary">
                <Icon name="history" size={17} />
                Audit global
              </a>
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                Nouveau compte
              </Button>
            </>
          }
        />

        {message && (
          <div className={`alert alert-${message.kind === 'error' ? 'error' : 'success'}`}>
            <Icon name={message.kind === 'error' ? 'x' : 'check'} size={16} />
            {message.text}
          </div>
        )}

        {pending.length > 0 && (
          <section className="card">
            <div className="card-body form-stack">
              <div className="section-title">
                <h2>Demandes de compte</h2>
                <Badge tone="warning">{pending.length} en attente</Badge>
              </div>
              <ul className="people-list">
                {pending.map((user) => (
                  <li key={user.id} className="person">
                    <Avatar name={user.displayName} />
                    <span className="person-text">
                      <strong>{user.displayName}</strong>
                      <small>
                        @{user.username}
                        {user.email ? ` · ${user.email}` : ''}
                      </small>
                    </span>
                    <span className="person-actions">
                      <Button size="sm" variant="ghost" onClick={() => remove(user)}>
                        Refuser
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        icon="check"
                        onClick={() =>
                          void update(user, { status: 'active' }, `Compte ${user.username} validé`)
                        }
                      >
                        Valider
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Rôle</th>
                <th>État</th>
                <th>Dernière connexion</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((user) => (
                <tr key={user.id}>
                  <td>
                    <span className="table-user">
                      <Avatar name={user.displayName} size="sm" />
                      <span className="person-text">
                        <strong>
                          {user.displayName}
                          {user.id === self && <span className="subtle"> (vous)</span>}
                        </strong>
                        <small>
                          @{user.username}
                          {user.email ? ` · ${user.email}` : ''}
                        </small>
                      </span>
                    </span>
                  </td>
                  <td>
                    {user.role === 'admin' ? (
                      <Badge tone="primary" icon="shield">
                        Admin
                      </Badge>
                    ) : (
                      <Badge>Utilisateur</Badge>
                    )}
                  </td>
                  <td>
                    <Badge tone={user.status === 'active' ? 'success' : 'danger'}>
                      {STATUS_LABELS[user.status]}
                    </Badge>{' '}
                    {user.mustChangePassword && (
                      <Badge tone="warning">Mot de passe temporaire</Badge>
                    )}
                  </td>
                  <td className="muted">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Jamais'}
                  </td>
                  <td className="table-actions">
                    <Menu
                      trigger={(props) => (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="more"
                          aria-label={`Actions pour ${user.username}`}
                          {...props}
                        />
                      )}
                    >
                      {user.id !== self && (
                        <>
                          <MenuItem
                            icon="shield"
                            onClick={() =>
                              void update(
                                user,
                                { role: user.role === 'admin' ? 'user' : 'admin' },
                                `Rôle de ${user.username} modifié`,
                              )
                            }
                          >
                            {user.role === 'admin' ? 'Retirer le rôle Admin' : 'Rendre Admin'}
                          </MenuItem>
                          <MenuItem
                            icon={user.status === 'active' ? 'lock' : 'check'}
                            onClick={() =>
                              void update(
                                user,
                                { status: user.status === 'active' ? 'disabled' : 'active' },
                                `Compte ${user.username} ${user.status === 'active' ? 'désactivé' : 'réactivé'}`,
                              )
                            }
                          >
                            {user.status === 'active' ? 'Désactiver' : 'Réactiver'}
                          </MenuItem>
                        </>
                      )}
                      <MenuItem icon="key" onClick={() => void resetPassword(user)}>
                        Réinitialiser le mot de passe
                      </MenuItem>
                      {user.id !== self && (
                        <>
                          <div className="divider" />
                          <MenuItem icon="trash" danger onClick={() => remove(user)}>
                            Supprimer le compte
                          </MenuItem>
                        </>
                      )}
                    </Menu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="card">
          <div className="card-body form-stack">
            <div className="section-title">
              <h2>Activité récente des comptes</h2>
              <a href="#/admin/audit">Tout l’audit →</a>
            </div>
            <ul className="activity">
              {events.slice(0, 12).map((event) => (
                <li key={event.id}>
                  <span
                    className={`activity-dot${event.action === 'auth.login_failed' ? ' danger' : ''}`}
                  />
                  <span>
                    <strong>{EVENT_LABELS[event.action] ?? event.action}</strong>{' '}
                    {event.objectId
                      ? (names.get(event.objectId) ?? String(event.metadata.username ?? ''))
                      : ''}
                    <span className="subtle">
                      {' · '}
                      {event.actorType === 'user'
                        ? `par ${names.get(event.actor) ?? event.actor}`
                        : event.actorType === 'system'
                          ? 'système'
                          : `IP ${event.actor}`}
                    </span>
                  </span>
                  <time className="subtle">{new Date(event.createdAt).toLocaleString()}</time>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {creating && (
        <Modal
          title="Nouveau compte"
          description="Un mot de passe temporaire est généré ; il devra être changé à la première connexion."
          onClose={() => setCreating(false)}
        >
          <CreateUserForm
            onCancel={() => setCreating(false)}
            onCreated={(username, password) => {
              setCreating(false);
              if (password) setSecret({ username, password });
              else setMessage({ kind: 'info', text: `Compte ${username} créé` });
              void load();
            }}
          />
        </Modal>
      )}

      {secret && (
        <Modal
          title="Mot de passe temporaire"
          description={
            <>
              À transmettre à <strong>{secret.username}</strong> : il ne sera plus affiché.
            </>
          }
          onClose={() => setSecret(null)}
        >
          <div className="secret">
            <code>{secret.password}</code>
            <Button
              size="sm"
              icon="copy"
              onClick={() => void copyText(secret.password, 'Mot de passe copié')}
            >
              Copier
            </Button>
          </div>
          <div className="modal-actions">
            <Button variant="primary" onClick={() => setSecret(null)}>
              C’est noté
            </Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

function CreateUserForm({
  onCreated,
  onCancel,
}: {
  onCreated: (username: string, password?: string) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({ username: '', displayName: '', email: '', role: 'user' });
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsed = CreateUserRequestSchema.safeParse({
      username: values.username,
      displayName: values.displayName,
      role: values.role,
      ...(values.email ? { email: values.email } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Formulaire invalide');
      return;
    }
    try {
      const result = TemporaryPasswordResponseSchema.partial({ temporaryPassword: true }).parse(
        await api('/admin/users', { method: 'POST', body: parsed.data }),
      );
      setValues({ username: '', displayName: '', email: '', role: 'user' });
      onCreated(result.user.username, result.temporaryPassword);
    } catch (caught) {
      setError(describe(caught));
    }
  };

  const field = (name: 'username' | 'displayName' | 'email') => ({
    className: 'input',
    value: values[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues({ ...values, [name]: event.target.value }),
  });

  return (
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <div className="form-row">
        <Field label="Nom d’utilisateur">
          <input
            placeholder="camille.martin"
            autoCapitalize="none"
            required
            // biome-ignore lint/a11y/noAutofocus: fenêtre ouverte à la demande de l'utilisateur
            autoFocus
            {...field('username')}
          />
        </Field>
        <Field label="Nom affiché">
          <input placeholder="Camille Martin" required {...field('displayName')} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="E-mail" hint="Facultatif">
          <input placeholder="camille@exemple.fr" type="email" {...field('email')} />
        </Field>
        <Field label="Rôle">
          <select
            className="select"
            value={values.role}
            onChange={(event) => setValues({ ...values, role: event.target.value })}
          >
            <option value="user">Utilisateur</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="modal-actions">
        <Button onClick={onCancel}>Annuler</Button>
        <Button type="submit" variant="primary">
          Créer le compte
        </Button>
      </div>
    </form>
  );
}

function describe(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Erreur inattendue';
}

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
      <main className="admin">
        <p>Réservé aux Admins.</p>
        <a href="#/">Accueil</a>
      </main>
    );
  }
  const self = session.user.id;
  const pending = users.filter(({ status }) => status === 'pending');
  const names = new Map(users.map((user) => [user.id, user.username]));

  return (
    <main className="admin">
      <nav>
        <a href="#/">Accueil</a>
        <a href="#/account">Mon compte</a>
      </nav>
      <h1>Administration</h1>

      {message && <p className={`admin-message ${message.kind}`}>{message.text}</p>}
      {secret && (
        <div className="admin-secret" role="status">
          <p>
            Mot de passe temporaire de <strong>{secret.username}</strong>, à lui transmettre (il ne
            sera plus affiché) :
          </p>
          <code>{secret.password}</code>
          <button type="button" onClick={() => setSecret(null)}>
            C’est noté
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <section>
          <h2>Demandes de compte ({pending.length})</h2>
          <ul className="admin-requests">
            {pending.map((user) => (
              <li key={user.id}>
                <span>
                  <strong>{user.displayName}</strong> — {user.username}
                  {user.email ? ` · ${user.email}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void update(user, { status: 'active' }, `Compte ${user.username} validé`)
                  }
                >
                  Valider
                </button>
                <button type="button" className="danger" onClick={() => remove(user)}>
                  Refuser
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Comptes</h2>
        <div className="admin-scroll">
          <table>
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Rôle</th>
                <th>État</th>
                <th>Dernière connexion</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users
                .filter(({ status }) => status !== 'pending')
                .map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.displayName}</strong>
                      <br />
                      <small>
                        {user.username}
                        {user.email ? ` · ${user.email}` : ''}
                      </small>
                    </td>
                    <td>{user.role === 'admin' ? 'Admin' : 'Utilisateur'}</td>
                    <td>
                      {STATUS_LABELS[user.status]}
                      {user.mustChangePassword && <small> · mot de passe temporaire</small>}
                    </td>
                    <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</td>
                    <td className="admin-actions">
                      {user.id !== self && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              void update(
                                user,
                                { role: user.role === 'admin' ? 'user' : 'admin' },
                                `Rôle de ${user.username} modifié`,
                              )
                            }
                          >
                            {user.role === 'admin' ? 'Retirer Admin' : 'Rendre Admin'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void update(
                                user,
                                { status: user.status === 'active' ? 'disabled' : 'active' },
                                `Compte ${user.username} ${user.status === 'active' ? 'désactivé' : 'réactivé'}`,
                              )
                            }
                          >
                            {user.status === 'active' ? 'Désactiver' : 'Réactiver'}
                          </button>
                        </>
                      )}
                      <button type="button" onClick={() => void resetPassword(user)}>
                        Réinitialiser le mot de passe
                      </button>
                      {user.id !== self && (
                        <button type="button" className="danger" onClick={() => remove(user)}>
                          Supprimer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <CreateUserForm
        onCreated={(username, password) => {
          if (password) setSecret({ username, password });
          else setMessage({ kind: 'info', text: `Compte ${username} créé` });
          void load();
        }}
      />

      <section>
        <h2>Événements de compte récents</h2>
        <p>
          <a href="#/admin/audit">Audit global</a> : comptes et tous les boards, filtrable et
          exportable.
        </p>
        <div className="admin-scroll">
          <table>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.createdAt).toLocaleString()}</td>
                  <td>{EVENT_LABELS[event.action] ?? event.action}</td>
                  <td>
                    {event.objectId
                      ? (names.get(event.objectId) ?? String(event.metadata.username ?? '—'))
                      : '—'}
                  </td>
                  <td>
                    <small>
                      {event.actorType === 'user'
                        ? `par ${names.get(event.actor) ?? event.actor}`
                        : event.actorType === 'system'
                          ? 'système'
                          : `IP ${event.actor}`}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function CreateUserForm({
  onCreated,
}: {
  onCreated: (username: string, password?: string) => void;
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
    value: values[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues({ ...values, [name]: event.target.value }),
  });

  return (
    <section>
      <h2>Créer un compte</h2>
      <form className="admin-create" onSubmit={(event) => void submit(event)}>
        <input
          placeholder="nom-utilisateur"
          autoCapitalize="none"
          required
          {...field('username')}
        />
        <input placeholder="Nom affiché" required {...field('displayName')} />
        <input placeholder="e-mail (facultatif)" type="email" {...field('email')} />
        <select
          value={values.role}
          onChange={(event) => setValues({ ...values, role: event.target.value })}
        >
          <option value="user">Utilisateur</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit">Créer</button>
      </form>
      <p className="admin-hint">
        Un mot de passe temporaire est généré ; il faudra le changer à la connexion.
      </p>
      {error && <p className="admin-message error">{error}</p>}
    </section>
  );
}

function describe(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Erreur inattendue';
}

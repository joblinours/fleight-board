import {
  ChangePasswordRequestSchema,
  MeResponseSchema,
  RegisterRequestSchema,
} from '@fleight/protocol';
import { type FormEvent, type ReactNode, useState } from 'react';
import type { ZodType } from 'zod';
import { ApiRequestError, api } from './api';
import { logout, setSessionUser, useSession } from './session';

/** Page à ouvrir après la connexion (`#/login?next=/board/demo`). */
export function nextRoute(): string {
  const query = window.location.hash.split('?')[1] ?? '';
  const next = new URLSearchParams(query).get('next');
  // Uniquement une route interne : pas de redirection vers un autre site.
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}

type FormError = { message: string; field?: string | undefined };

/** Valide côté client avec le schéma de l'API, puis appelle `submit`. */
function useForm<T>(schema: ZodType<T> | undefined, submit: (values: T) => Promise<void>) {
  const [error, setError] = useState<FormError | null>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (event: FormEvent<HTMLFormElement>, raw: unknown) => {
    event.preventDefault();
    setError(null);
    let values = raw as T;
    if (schema) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path[0];
        setError({
          message: issue?.message ?? 'Formulaire invalide',
          field: typeof field === 'string' ? field : undefined,
        });
        return;
      }
      values = parsed.data;
    }
    setBusy(true);
    try {
      await submit(values);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? { message: caught.message, field: caught.field }
          : { message: 'Erreur inattendue' },
      );
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, onSubmit, setError };
}

function Field({
  label,
  name,
  error,
  hint,
  ...input
}: {
  label: string;
  name: string;
  error: FormError | null;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const invalid = error?.field === name;
  return (
    <label className={`auth-field${invalid ? ' invalid' : ''}`}>
      <span>{label}</span>
      <input name={name} aria-invalid={invalid} {...input} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <p className="auth-brand">
          <a href="#/">Fleight Board</a>
        </p>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

function ErrorMessage({ error }: { error: FormError | null }) {
  return error ? (
    <p className="auth-error" role="alert">
      {error.message}
    </p>
  ) : null;
}

export function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const form = useForm<{ identifier: string; password: string }>(undefined, async (values) => {
    const { user } = MeResponseSchema.parse(
      await api('/auth/login', { method: 'POST', body: values }),
    );
    // La redirection (page demandée, ou changement d'un mot de passe temporaire) suit.
    setSessionUser(user);
  });

  return (
    <AuthLayout title="Connexion">
      <form onSubmit={(event) => form.onSubmit(event, { identifier, password })}>
        <Field
          label="Nom d’utilisateur ou e-mail"
          name="identifier"
          error={form.error}
          value={identifier}
          autoComplete="username"
          autoCapitalize="none"
          required
          onChange={(event) => setIdentifier(event.target.value)}
        />
        <Field
          label="Mot de passe"
          name="password"
          type="password"
          error={form.error}
          value={password}
          autoComplete="current-password"
          required
          onChange={(event) => setPassword(event.target.value)}
        />
        <ErrorMessage error={form.error} />
        <button type="submit" disabled={form.busy}>
          {form.busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <p className="auth-alt">
        Pas encore de compte ? <a href="#/register">Demander un compte</a>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const [values, setValues] = useState({
    username: '',
    email: '',
    displayName: '',
    password: '',
    confirm: '',
  });
  const [sent, setSent] = useState(false);
  const form = useForm(RegisterRequestSchema, async (request) => {
    await api('/auth/register', { method: 'POST', body: request });
    setSent(true);
  });
  const update = (name: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues({ ...values, [name]: event.target.value });

  if (sent) {
    return (
      <AuthLayout title="Demande envoyée">
        <p>Un Admin doit valider votre compte. Vous pourrez ensuite vous connecter.</p>
        <p className="auth-alt">
          <a href="#/login">Retour à la connexion</a>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Demander un compte">
      <form
        onSubmit={(event) => {
          if (values.password !== values.confirm) {
            event.preventDefault();
            form.setError({ message: 'Les mots de passe ne correspondent pas', field: 'confirm' });
            return;
          }
          const { confirm: _confirm, email, ...request } = values;
          void form.onSubmit(event, { ...request, ...(email ? { email } : {}) });
        }}
      >
        <Field
          label="Nom d’utilisateur"
          name="username"
          error={form.error}
          value={values.username}
          autoComplete="username"
          autoCapitalize="none"
          hint="3 à 32 caractères : lettres, chiffres, « . », « _ », « - »"
          required
          onChange={update('username')}
        />
        <Field
          label="Nom affiché"
          name="displayName"
          error={form.error}
          value={values.displayName}
          autoComplete="name"
          required
          onChange={update('displayName')}
        />
        <Field
          label="E-mail (facultatif)"
          name="email"
          type="email"
          error={form.error}
          value={values.email}
          autoComplete="email"
          onChange={update('email')}
        />
        <Field
          label="Mot de passe"
          name="password"
          type="password"
          error={form.error}
          value={values.password}
          autoComplete="new-password"
          hint="Au moins 10 caractères"
          required
          onChange={update('password')}
        />
        <Field
          label="Confirmation"
          name="confirm"
          type="password"
          error={form.error}
          value={values.confirm}
          autoComplete="new-password"
          required
          onChange={update('confirm')}
        />
        <ErrorMessage error={form.error} />
        <button type="submit" disabled={form.busy}>
          Envoyer la demande
        </button>
      </form>
      <p className="auth-alt">
        Déjà un compte ? <a href="#/login">Se connecter</a>
      </p>
    </AuthLayout>
  );
}

export function AccountPage() {
  const session = useSession();
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [changed, setChanged] = useState(false);
  const form = useForm(ChangePasswordRequestSchema, async (request) => {
    await api('/auth/password', { method: 'POST', body: request });
    const { user } = MeResponseSchema.parse(await api('/auth/me'));
    setSessionUser(user);
    setValues({ currentPassword: '', newPassword: '', confirm: '' });
    setChanged(true);
  });
  if (session.status !== 'authenticated') return null;
  const { user } = session;
  const update = (name: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues({ ...values, [name]: event.target.value });

  return (
    <AuthLayout title="Mon compte">
      <dl className="auth-profile">
        <dt>Nom affiché</dt>
        <dd>{user.displayName}</dd>
        <dt>Nom d’utilisateur</dt>
        <dd>{user.username}</dd>
        {user.email && (
          <>
            <dt>E-mail</dt>
            <dd>{user.email}</dd>
          </>
        )}
        <dt>Rôle</dt>
        <dd>{user.role === 'admin' ? 'Admin' : 'Utilisateur'}</dd>
      </dl>

      <h2>Changer de mot de passe</h2>
      {user.mustChangePassword && (
        <p className="auth-warning">
          Votre mot de passe est temporaire : choisissez-en un nouveau pour continuer.
        </p>
      )}
      {changed && (
        <p className="auth-success">Mot de passe changé ; vos autres sessions sont fermées.</p>
      )}
      <form
        onSubmit={(event) => {
          if (values.newPassword !== values.confirm) {
            event.preventDefault();
            form.setError({ message: 'Les mots de passe ne correspondent pas', field: 'confirm' });
            return;
          }
          void form.onSubmit(event, {
            currentPassword: values.currentPassword,
            newPassword: values.newPassword,
          });
        }}
      >
        <Field
          label="Mot de passe actuel"
          name="currentPassword"
          type="password"
          error={form.error}
          value={values.currentPassword}
          autoComplete="current-password"
          required
          onChange={update('currentPassword')}
        />
        <Field
          label="Nouveau mot de passe"
          name="newPassword"
          type="password"
          error={form.error}
          value={values.newPassword}
          autoComplete="new-password"
          hint="Au moins 10 caractères"
          required
          onChange={update('newPassword')}
        />
        <Field
          label="Confirmation"
          name="confirm"
          type="password"
          error={form.error}
          value={values.confirm}
          autoComplete="new-password"
          required
          onChange={update('confirm')}
        />
        <ErrorMessage error={form.error} />
        <button type="submit" disabled={form.busy}>
          Changer le mot de passe
        </button>
      </form>
      <p className="auth-alt">
        {!user.mustChangePassword && <a href="#/">Accueil</a>}
        {!user.mustChangePassword && ' · '}
        <button type="button" className="link" onClick={() => void logout()}>
          Se déconnecter
        </button>
      </p>
    </AuthLayout>
  );
}

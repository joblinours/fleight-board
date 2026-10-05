import {
  ChangePasswordRequestSchema,
  MeResponseSchema,
  RegisterRequestSchema,
} from '@fleight/protocol';
import { type FormEvent, type ReactNode, useState } from 'react';
import type { ZodType } from 'zod';
import { AppShell, Logo, PageHeader } from '../layout/AppShell';
import { Avatar, Badge, Button } from '../ui/components';
import { Icon } from '../ui/Icon';
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
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input" name={name} aria-invalid={invalid} {...input} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Pages d'authentification : panneau de marque à gauche, formulaire à droite. */
function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="auth">
      <section className="auth-aside">
        <a href="#/" className="auth-logo">
          <Logo />
        </a>
        <div className="auth-aside-text">
          <h2>Le whiteboard collaboratif, auto-hébergé.</h2>
          <p>
            Dessin libre, schémas et collaboration en temps réel, sur ordinateur comme sur iPad.
          </p>
        </div>
        <p className="auth-aside-foot">© Fleight Board</p>
      </section>
      <section className="auth-main">
        <div className="auth-form">
          <a href="#/" className="auth-logo-mobile">
            <Logo />
          </a>
          <div className="auth-title">
            <h1>{title}</h1>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

function ErrorMessage({ error }: { error: FormError | null }) {
  return error ? (
    <div className="alert alert-error" role="alert">
      <Icon name="x" size={16} />
      {error.message}
    </div>
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
    <AuthLayout
      title="Bon retour parmi nous"
      subtitle="Connectez-vous pour retrouver vos tableaux."
    >
      <form
        className="form-stack"
        onSubmit={(event) => form.onSubmit(event, { identifier, password })}
      >
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
        <Button type="submit" variant="primary" size="lg" block disabled={form.busy}>
          {form.busy ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
      <p className="auth-alt">
        Pas encore de compte ? <a href="#/register">Demander un compte</a>
      </p>
      <p className="auth-alt">
        Invité ? <a href="#/">Rejoindre un tableau avec un code</a>
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
        <div className="alert alert-success">
          <Icon name="check" size={16} />
          Un Admin doit valider votre compte. Vous pourrez ensuite vous connecter.
        </div>
        <a href="#/login" className="btn btn-secondary btn-lg btn-block">
          Retour à la connexion
        </a>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Demander un compte" subtitle="Un administrateur validera votre demande.">
      <form
        className="form-stack"
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
        <Button type="submit" variant="primary" size="lg" block disabled={form.busy}>
          Envoyer la demande
        </Button>
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

  const content = (
    <div className="page page-narrow">
      <PageHeader title="Mon compte" subtitle="Profil et sécurité de votre compte." />
      <section className="card">
        <div className="card-body profile">
          <Avatar name={user.displayName} size="lg" />
          <div>
            <h2>{user.displayName}</h2>
            <p className="muted">
              @{user.username}
              {user.email && ` · ${user.email}`}
            </p>
          </div>
          <Badge tone={user.role === 'admin' ? 'primary' : undefined}>
            {user.role === 'admin' ? 'Administrateur' : 'Utilisateur'}
          </Badge>
        </div>
      </section>

      <section className="card">
        <div className="card-body form-stack">
          <div>
            <h2>Mot de passe</h2>
            <p className="muted">Changer de mot de passe ferme vos autres sessions.</p>
          </div>
          {user.mustChangePassword && (
            <div className="alert alert-warning">
              <Icon name="key" size={16} />
              Votre mot de passe est temporaire : choisissez-en un nouveau pour continuer.
            </div>
          )}
          {changed && (
            <div className="alert alert-success">
              <Icon name="check" size={16} />
              Mot de passe changé ; vos autres sessions sont fermées.
            </div>
          )}
          <form
            className="form-stack"
            onSubmit={(event) => {
              if (values.newPassword !== values.confirm) {
                event.preventDefault();
                form.setError({
                  message: 'Les mots de passe ne correspondent pas',
                  field: 'confirm',
                });
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
            <div className="form-row">
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
            </div>
            <ErrorMessage error={form.error} />
            <div>
              <Button type="submit" variant="primary" disabled={form.busy}>
                Changer le mot de passe
              </Button>
            </div>
          </form>
        </div>
      </section>
      {user.mustChangePassword && (
        <div>
          <Button icon="logout" onClick={() => void logout()}>
            Se déconnecter
          </Button>
        </div>
      )}
    </div>
  );
  // Mot de passe temporaire : pas de navigation tant qu'il n'est pas changé.
  return user.mustChangePassword ? (
    <main className="auth-standalone">{content}</main>
  ) : (
    <AppShell>{content}</AppShell>
  );
}

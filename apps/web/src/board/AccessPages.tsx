import { CollaborationClient } from '@fleight/collaboration';
import {
  BoardCodeSchema,
  type BoardSummary,
  GuestNameSchema,
  GuestResponseSchema,
} from '@fleight/protocol';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiRequestError, api } from '../auth/api';
import { Logo } from '../layout/AppShell';
import { Button, Field, Spinner } from '../ui/components';
import { Icon } from '../ui/Icon';
import { BoardPage } from './BoardPage';
import { CloseCodes, connectWebSocket } from './websocket-transport';

function describe(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Erreur inattendue';
}

/**
 * Salle d'attente d'une session privée : la connexion WebSocket attend la
 * décision du propriétaire ou d'un Co-owner, qui arrive en temps réel.
 */
export function WaitingRoom({
  boardId,
  name,
  onGranted,
}: {
  boardId: string;
  name: string;
  onGranted: () => void;
}) {
  const [denied, setDenied] = useState(false);
  // Rappel lu au moment de l'acceptation : la connexion ne dépend pas de son identité.
  const onGrantedRef = useRef(onGranted);
  onGrantedRef.current = onGranted;

  useEffect(() => {
    let granted = false;
    const client = new CollaborationClient({
      boardId,
      name,
      onStatus: (status) => {
        // Acceptée : la page du board ouvre sa propre session.
        if (status === 'joined' && !granted) {
          granted = true;
          disconnect();
          onGrantedRef.current();
        }
      },
    });
    const disconnect = connectWebSocket(client, undefined, (code) => {
      if (code === CloseCodes.Forbidden) setDenied(true);
    });
    return () => disconnect();
  }, [boardId, name]);

  return (
    <AccessLayout>
      {denied ? (
        <>
          <span className="access-icon danger">
            <Icon name="x" size={24} />
          </span>
          <h1>Demande refusée</h1>
          <p className="muted">Le propriétaire du tableau n’a pas accepté votre demande.</p>
          <a href="#/" className="btn btn-secondary">
            Retour à l’accueil
          </a>
        </>
      ) : (
        <>
          <span className="access-icon pulse">
            <Icon name="clock" size={24} />
          </span>
          <h1 className="access-waiting">En attente d’acceptation</h1>
          <p className="muted access-hint">
            Votre demande a été envoyée. Le propriétaire du tableau ou un Co-owner doit l’accepter :
            la page s’ouvrira automatiquement.
          </p>
          <a href="#/" className="btn btn-ghost">
            Annuler
          </a>
        </>
      )}
    </AccessLayout>
  );
}

/** Board privé, sans accès : demander l'accès, puis attendre la décision. */
export function AccessRequestView({
  boardId,
  name,
  onGranted,
}: {
  boardId: string;
  name: string;
  onGranted: () => void;
}) {
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async () => {
    setError(null);
    try {
      const { status } = await api<{ status: string }>(`/boards/${boardId}/access-requests`, {
        method: 'POST',
      });
      if (status === 'granted') onGranted();
      else setRequested(true);
    } catch (caught) {
      setError(describe(caught));
    }
  };

  if (requested) return <WaitingRoom boardId={boardId} name={name} onGranted={onGranted} />;
  return (
    <AccessLayout>
      <span className="access-icon">
        <Icon name="lock" size={24} />
      </span>
      <h1>Tableau privé</h1>
      <p className="muted access-hint">
        Son propriétaire doit vous accepter avant que vous puissiez l’ouvrir.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <Button variant="primary" size="lg" icon="key" onClick={() => void request()}>
        Demander l’accès
      </Button>
      <a href="#/">Retour aux tableaux</a>
    </AccessLayout>
  );
}

/** Rejoindre un board sans compte : code (s'il n'est pas dans le lien) et nom affiché. */
export function GuestJoinForm({ code: initialCode }: { code?: string }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsedCode = BoardCodeSchema.safeParse(code);
    const parsedName = GuestNameSchema.safeParse(name);
    if (!parsedCode.success) return setError('Code à 6 caractères');
    if (!parsedName.success) return setError(parsedName.error.issues[0]?.message ?? 'Nom invalide');
    setBusy(true);
    try {
      GuestResponseSchema.parse(
        await api(`/boards/code/${parsedCode.data}/guest`, {
          method: 'POST',
          body: { name: parsedName.data },
        }),
      );
      window.location.hash = '#/guest';
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="guest-join form-stack" onSubmit={(event) => void submit(event)}>
      <div>
        <h2>Rejoindre un tableau</h2>
        <p className="muted">Sans compte : un code et votre nom suffisent.</p>
      </div>
      {!initialCode && (
        <Field label="Code du tableau">
          <input
            className="input input-code"
            value={code}
            placeholder="K7P4X2"
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </Field>
      )}
      <Field label="Votre nom" hint="Affiché aux autres participants">
        <input
          className="input"
          value={name}
          maxLength={40}
          autoComplete="nickname"
          placeholder="Ex. : Camille"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      {error && <div className="alert alert-error">{error}</div>}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        disabled={busy}
        iconRight="chevronRight"
      >
        Rejoindre en invité
      </Button>
    </form>
  );
}

/** Lien `#/join/<CODE>` sans être connecté : entrer en invité, ou se connecter. */
export function GuestJoinPage({ code }: { code: string }) {
  return (
    <AccessLayout>
      <div className="card access-card">
        <div className="card-body">
          <GuestJoinForm code={code} />
          <p className="auth-alt">
            Vous avez un compte ?{' '}
            <a href={`#/login?next=${encodeURIComponent(`/join/${code}`)}`}>Connectez-vous</a>
          </p>
        </div>
      </div>
    </AccessLayout>
  );
}

type GuestState =
  | { kind: 'loading' }
  | { kind: 'ready'; board: BoardSummary; name: string; waiting: boolean }
  | { kind: 'error'; message: string };

/** Board de l'invité de la session courante (cookie), ou sa salle d'attente. */
export function GuestRoute() {
  const [state, setState] = useState<GuestState>({ kind: 'loading' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    void version;
    let cancelled = false;
    api('/guest')
      .then((data) => {
        if (cancelled) return;
        const { guest, board } = GuestResponseSchema.parse(data);
        setState({ kind: 'ready', board, name: guest.displayName, waiting: !board.role });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message:
              error instanceof ApiRequestError && error.status === 401
                ? 'Votre accès invité a expiré : rejoignez à nouveau le board avec son code.'
                : describe(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  switch (state.kind) {
    case 'loading':
      return (
        <div className="page-loading full">
          <Spinner />
        </div>
      );
    case 'error':
      return (
        <AccessLayout>
          <span className="access-icon danger">
            <Icon name="clock" size={24} />
          </span>
          <h1>Accès invité indisponible</h1>
          <p className="muted access-hint">{state.message}</p>
          <a href="#/" className="btn btn-secondary">
            Accueil
          </a>
        </AccessLayout>
      );
    case 'ready':
      return state.waiting ? (
        <WaitingRoom
          boardId={state.board.id}
          name={state.name}
          onGranted={() => setVersion((current) => current + 1)}
        />
      ) : (
        <BoardPage board={state.board} guestName={state.name} />
      );
  }
}

/** Page centrée des parcours d'accès (invité, attente, board privé). */
export function AccessLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="access-page">
      <a href="#/" className="access-logo">
        <Logo />
      </a>
      <div className="access-content">{children}</div>
    </main>
  );
}

import { CollaborationClient } from '@fleight/collaboration';
import {
  BoardCodeSchema,
  type BoardSummary,
  GuestNameSchema,
  GuestResponseSchema,
} from '@fleight/protocol';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiRequestError, api } from '../auth/api';
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
    <main className="page-status access-page">
      {denied ? (
        <>
          <p>Votre demande d’accès a été refusée.</p>
          <a href="#/">Accueil</a>
        </>
      ) : (
        <>
          <p className="access-waiting">Demande envoyée : en attente d’acceptation…</p>
          <p className="access-hint">
            Le propriétaire du board ou un Co-owner doit l’accepter. Cette page s’ouvrira
            automatiquement.
          </p>
          <a href="#/">Annuler</a>
        </>
      )}
    </main>
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
    <main className="page-status access-page">
      <p>Ce board est privé : son propriétaire doit vous accepter.</p>
      {error && <p className="boards-error">{error}</p>}
      <p>
        <button type="button" onClick={() => void request()}>
          Demander l’accès
        </button>
      </p>
      <a href="#/">Accueil</a>
    </main>
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
    <form className="guest-join" onSubmit={(event) => void submit(event)}>
      <h2>Rejoindre sans compte</h2>
      {!initialCode && (
        <label className="guest-join-field">
          Code du board
          <input
            value={code}
            placeholder="CODE"
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </label>
      )}
      <label className="guest-join-field">
        Votre nom
        <input
          value={name}
          maxLength={40}
          autoComplete="nickname"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error && <p className="boards-error">{error}</p>}
      <button type="submit" disabled={busy}>
        Rejoindre en invité
      </button>
    </form>
  );
}

/** Lien `#/join/<CODE>` sans être connecté : entrer en invité, ou se connecter. */
export function GuestJoinPage({ code }: { code: string }) {
  return (
    <main className="page-status access-page">
      <GuestJoinForm code={code} />
      <p>
        ou <a href={`#/login?next=${encodeURIComponent(`/join/${code}`)}`}>se connecter</a> avec un
        compte
      </p>
    </main>
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
      return <p className="page-status">Chargement du board…</p>;
    case 'error':
      return (
        <main className="page-status">
          <p>{state.message}</p>
          <a href="#/">Accueil</a>
        </main>
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

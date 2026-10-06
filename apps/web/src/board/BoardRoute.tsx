import { BoardIdSchema, BoardResponseSchema, type BoardSummary } from '@fleight/protocol';
import { useEffect, useState } from 'react';
import { ApiRequestError, api } from '../auth/api';
import { useSession } from '../auth/session';
import { Button, Spinner } from '../ui/components';
import { Icon } from '../ui/Icon';
import { AccessLayout, AccessRequestView } from './AccessPages';
import { BoardPage } from './BoardPage';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; board: BoardSummary }
  | { kind: 'missing' }
  | { kind: 'private' }
  | { kind: 'error'; message: string };

/** Charge un board (nom, format, code) avant de l'ouvrir ; propose de le créer s'il n'existe pas. */
export function BoardRoute({ boardId }: { boardId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [creating, setCreating] = useState(false);
  // Incrémenté pour recharger le board (accès accordé).
  const [version, setVersion] = useState(0);
  const session = useSession();

  useEffect(() => {
    void version;
    let cancelled = false;
    api(`/boards/${boardId}`)
      .then((data) => {
        if (!cancelled) setState({ kind: 'ready', board: BoardResponseSchema.parse(data).board });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.status === 404) setState({ kind: 'missing' });
        else if (error instanceof ApiRequestError && error.status === 403) {
          setState({ kind: 'private' });
        } else
          setState({ kind: 'error', message: error instanceof Error ? error.message : 'Erreur' });
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, version]);

  const create = async () => {
    setCreating(true);
    try {
      const data = await api('/boards', { method: 'POST', body: { id: boardId, name: boardId } });
      setState({ kind: 'ready', board: BoardResponseSchema.parse(data).board });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Erreur' });
    } finally {
      setCreating(false);
    }
  };

  switch (state.kind) {
    case 'loading':
      return (
        <div className="page-loading full">
          <Spinner />
        </div>
      );
    case 'ready':
      return <BoardPage board={state.board} />;
    case 'private':
      return (
        <AccessRequestView
          boardId={boardId}
          name={session.status === 'authenticated' ? session.user.displayName : 'Invité'}
          onGranted={() => {
            setState({ kind: 'loading' });
            setVersion((current) => current + 1);
          }}
        />
      );
    case 'error':
      return (
        <AccessLayout>
          <span className="access-icon danger">
            <Icon name="x" size={24} />
          </span>
          <h1>Impossible d’ouvrir ce tableau</h1>
          <p className="muted access-hint">{state.message}</p>
          <a href="#/" className="btn btn-secondary">
            Retour aux tableaux
          </a>
        </AccessLayout>
      );
    case 'missing':
      return (
        <AccessLayout>
          <span className="access-icon">
            <Icon name="search" size={24} />
          </span>
          <h1>Tableau introuvable</h1>
          <p className="muted access-hint">Aucun tableau ne porte l’identifiant « {boardId} ».</p>
          {BoardIdSchema.safeParse(boardId).success && (
            <Button variant="primary" icon="plus" disabled={creating} onClick={() => void create()}>
              Créer ce tableau
            </Button>
          )}
          <a href="#/">Retour aux tableaux</a>
        </AccessLayout>
      );
  }
}

/** Lien de partage `#/join/<CODE>` : retrouve le board puis l'ouvre. */
export function JoinRoute({ code }: { code: string }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api(`/boards/code/${code.toUpperCase()}`)
      .then((data) => {
        window.location.replace(`#/board/${BoardResponseSchema.parse(data).board.id}`);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Erreur'));
  }, [code]);
  return (
    <AccessLayout>
      {error ? (
        <>
          <span className="access-icon danger">
            <Icon name="x" size={24} />
          </span>
          <h1>Code introuvable</h1>
          <p className="muted access-hint">{error}</p>
          <a href="#/" className="btn btn-secondary">
            Retour aux tableaux
          </a>
        </>
      ) : (
        <Spinner />
      )}
    </AccessLayout>
  );
}

import { AuditLogResponseSchema, type AuditRecord } from '@fleight/protocol';
import { useCallback, useEffect, useState } from 'react';

/** Rafraîchissement automatique de la liste. */
const REFRESH_MS = 2000;

const ACTIONS: Record<AuditRecord['action'], string> = {
  'object.create': 'Création',
  'object.update': 'Modification',
  'object.delete': 'Suppression',
};

const INTENTS = { undo: 'annulation', redo: 'rétablissement' } as const;

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; entries: AuditRecord[] }
  | { kind: 'error'; message: string };

/** Audit d'un board : une ligne par opération finale, la plus récente en haut. */
export function AuditPage({ boardId }: { boardId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const response = await fetch(`/api/boards/${boardId}/audit?limit=200`, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = AuditLogResponseSchema.parse(await response.json());
        setState({ kind: 'ok', entries: body.entries });
      } catch (error) {
        if (signal.aborted) return;
        setState({ kind: 'error', message: error instanceof Error ? error.message : 'erreur' });
      }
    },
    [boardId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => void load(controller.signal), REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  return (
    <main className="audit">
      <nav>
        <a href="#/">Accueil</a>
        <a href={`#/board/${boardId}`}>Ouvrir le board</a>
      </nav>
      <h1>Audit — {boardId}</h1>
      <p className="audit-help">
        Une ligne par opération finale (un tracé ou un déplacement = une ligne), annulations
        comprises. Mise à jour toutes les {REFRESH_MS / 1000} s.
      </p>

      {state.kind === 'loading' && <p>Chargement…</p>}
      {state.kind === 'error' && (
        <p className="audit-error">Audit indisponible ({state.message}) — l’API tourne-t-elle ?</p>
      )}
      {state.kind === 'ok' && state.entries.length === 0 && <p>Aucune opération enregistrée.</p>}
      {state.kind === 'ok' && state.entries.length > 0 && (
        <div className="audit-scroll">
          <table>
            <thead>
              <tr>
                <th>Heure</th>
                <th>Auteur</th>
                <th>Action</th>
                <th>Objet</th>
                <th>Détails</th>
              </tr>
            </thead>
            <tbody>
              {state.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleTimeString()}</td>
                  <td title={`client ${entry.actor} · session ${entry.sessionId ?? '—'}`}>
                    {entry.metadata.actorName ?? shortId(entry.actor)}
                  </td>
                  <td>
                    {ACTIONS[entry.action]}
                    {entry.metadata.intent && (
                      <span className={`audit-intent ${entry.metadata.intent}`}>
                        {INTENTS[entry.metadata.intent]}
                      </span>
                    )}
                  </td>
                  <td title={entry.objectId ?? ''}>
                    {entry.metadata.objectType ?? ''} {shortId(entry.objectId ?? '')}
                  </td>
                  <td>{details(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function details(entry: AuditRecord): string {
  const parts: string[] = [];
  if (entry.metadata.fields?.length) parts.push(entry.metadata.fields.join(', '));
  if (entry.metadata.gestureId) parts.push('geste');
  parts.push(`seq ${entry.metadata.seq}`);
  return parts.join(' · ');
}

/** Fin d'un identifiant (ULID) : suffisant pour distinguer les lignes. */
function shortId(id: string): string {
  return id.length > 8 ? `…${id.slice(-6)}` : id;
}

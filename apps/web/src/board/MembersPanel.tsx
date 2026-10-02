import { assignableRoles, can, canChangeRole, canManage, ROLE_LABELS } from '@fleight/permissions';
import {
  type BoardMembersResponse,
  BoardMembersResponseSchema,
  type DefaultRole,
  type MemberRole,
} from '@fleight/protocol';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../auth/api';

const DEFAULT_ROLE_LABELS: Record<DefaultRole, string> = {
  none: 'Membres seulement',
  viewer: 'Lecture (Viewer)',
  editor: 'Édition (Editor)',
};

function describe(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Erreur inattendue';
}

/**
 * Membres d'un board : liste, ajout, rôles, retrait, transfert de propriété et
 * accès des non-membres. Les actions proposées suivent le rôle de l'utilisateur ;
 * le serveur les vérifie de toute façon.
 */
export function MembersPanel({
  boardId,
  selfId,
  onClose,
}: {
  boardId: string;
  /** Compte de l'utilisateur connecté. */
  selfId: string | undefined;
  onClose: () => void;
}) {
  const [data, setData] = useState<BoardMembersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [newRole, setNewRole] = useState<MemberRole>('editor');

  const load = useCallback(async () => {
    try {
      setData(BoardMembersResponseSchema.parse(await api(`/boards/${boardId}/members`)));
    } catch (caught) {
      setError(describe(caught));
    }
  }, [boardId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(describe(caught));
    }
    await load();
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!identifier.trim()) return;
    void act(async () => {
      await api(`/boards/${boardId}/members`, {
        method: 'POST',
        body: { identifier, role: newRole },
      });
      setIdentifier('');
    });
  };

  const role = data?.role;
  const roles = assignableRoles(role);

  return (
    <div className="board-members" role="dialog" aria-label="Membres du board">
      <div className="board-members-head">
        <h2>Membres</h2>
        <button type="button" onClick={onClose} aria-label="Fermer">
          ×
        </button>
      </div>
      {error && <p className="boards-error">{error}</p>}
      {!data && !error && <p>Chargement…</p>}
      {data && role && (
        <>
          <p className="board-members-you">
            Votre rôle : <strong>{ROLE_LABELS[role]}</strong>
          </p>
          <ul>
            {data.owner && (
              <li>
                <span>
                  {data.owner.displayName}
                  <small> @{data.owner.username}</small>
                </span>
                <span className="board-members-role">Owner</span>
              </li>
            )}
            {data.members.map((member) => (
              <li key={member.userId}>
                <span>
                  {member.displayName}
                  <small> @{member.username}</small>
                  {member.userId === selfId && <small> (vous)</small>}
                </span>
                {canManage(role, member.role) ? (
                  <select
                    aria-label={`Rôle de ${member.displayName}`}
                    value={member.role}
                    onChange={(event) =>
                      void act(() =>
                        api(`/boards/${boardId}/members/${member.userId}`, {
                          method: 'PATCH',
                          body: { role: event.target.value },
                        }),
                      )
                    }
                  >
                    {roles.map((option) => (
                      <option
                        key={option}
                        value={option}
                        disabled={!canChangeRole(role, member.role, option)}
                      >
                        {ROLE_LABELS[option]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="board-members-role">{ROLE_LABELS[member.role]}</span>
                )}
                <span className="board-members-actions">
                  {can(role, 'board.transfer') && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Transférer la propriété à ${member.displayName} ? Vous deviendrez Co-owner.`,
                          )
                        ) {
                          void act(() =>
                            api(`/boards/${boardId}/transfer`, {
                              method: 'POST',
                              body: { userId: member.userId },
                            }),
                          );
                        }
                      }}
                    >
                      Transférer
                    </button>
                  )}
                  {(canManage(role, member.role) || member.userId === selfId) && (
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        void act(() =>
                          api(`/boards/${boardId}/members/${member.userId}`, {
                            method: 'DELETE',
                          }),
                        )
                      }
                    >
                      {member.userId === selfId ? 'Quitter' : 'Retirer'}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {roles.length > 0 && (
            <form className="board-members-add" onSubmit={add}>
              <input
                className="board-members-identifier"
                value={identifier}
                placeholder="Nom d’utilisateur ou e-mail"
                aria-label="Nom d’utilisateur ou e-mail"
                autoComplete="off"
                onChange={(event) => setIdentifier(event.target.value)}
              />
              <select
                aria-label="Rôle du nouveau membre"
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as MemberRole)}
              >
                {roles.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
              <button type="submit">Ajouter</button>
            </form>
          )}

          <label className="board-members-default">
            Accès des autres utilisateurs (lien ou code)
            <select
              value={data.defaultRole}
              disabled={!can(role, 'board.settings')}
              onChange={(event) =>
                void act(() =>
                  api(`/boards/${boardId}`, {
                    method: 'PATCH',
                    body: { defaultRole: event.target.value },
                  }),
                )
              }
            >
              {(Object.keys(DEFAULT_ROLE_LABELS) as DefaultRole[]).map((option) => (
                <option key={option} value={option}>
                  {DEFAULT_ROLE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

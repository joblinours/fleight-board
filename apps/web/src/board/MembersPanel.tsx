import { assignableRoles, can, canChangeRole, canManage, ROLE_LABELS } from '@fleight/permissions';
import {
  type AccessDuration,
  type AccessLimit,
  type AccessRequest,
  AccessRequestsResponseSchema,
  type BoardMembersResponse,
  BoardMembersResponseSchema,
  type BoardRole,
  type DefaultRole,
  type MemberRole,
} from '@fleight/protocol';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../auth/api';

const DEFAULT_ROLE_LABELS: Record<DefaultRole, string> = {
  viewer: 'Lecture (Viewer)',
  editor: 'Édition (Editor)',
};

/** Durées proposées pour un accès accordé. */
const DURATIONS: Array<{ value: string; label: string; duration: AccessDuration }> = [
  { value: 'permanent', label: 'Permanent', duration: { kind: 'permanent' } },
  { value: '1h', label: '1 heure', duration: { kind: 'temporary', minutes: 60 } },
  { value: '1d', label: '1 jour', duration: { kind: 'temporary', minutes: 24 * 60 } },
  { value: '7d', label: '7 jours', duration: { kind: 'temporary', minutes: 7 * 24 * 60 } },
  {
    value: 'while-connected',
    label: 'Tant que je suis connecté',
    duration: { kind: 'while-connected' },
  },
];

function durationOf(value: string): AccessDuration {
  return DURATIONS.find((option) => option.value === value)?.duration ?? { kind: 'permanent' };
}

function describe(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Erreur inattendue';
}

/** Limite d'un accès en clair : « jusqu'au … », « tant que … est connecté ». */
function limitLabel(limit: AccessLimit): string | null {
  if (limit.whileConnected) return `tant que ${limit.whileConnected.displayName} est connecté`;
  if (!limit.expiresAt) return null;
  const date = new Date(limit.expiresAt);
  return date.getTime() < Date.now() ? 'accès expiré' : `jusqu’au ${date.toLocaleString()}`;
}

function DurationSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {DURATIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Membres d'un board : accès (session publique ou privée, invités), demandes
 * d'accès, membres et invités, ajout, rôles et durées, transfert de propriété.
 * Les actions proposées suivent le rôle de l'utilisateur ; le serveur les
 * vérifie de toute façon.
 */
export function MembersPanel({
  boardId,
  selfId,
  requestsVersion,
  onRequests,
  onClose,
}: {
  boardId: string;
  /** Compte de l'utilisateur connecté. */
  selfId: string | undefined;
  /** Change quand les demandes d'accès changent (événement de la session). */
  requestsVersion: number;
  /** Nombre de demandes en attente, après chaque chargement. */
  onRequests: (count: number) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<BoardMembersResponse | null>(null);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [newRole, setNewRole] = useState<MemberRole>('editor');
  const [newDuration, setNewDuration] = useState('permanent');

  const load = useCallback(async () => {
    try {
      const members = BoardMembersResponseSchema.parse(await api(`/boards/${boardId}/members`));
      setData(members);
      if (can(members.role, 'board.members')) {
        const pending = AccessRequestsResponseSchema.parse(
          await api(`/boards/${boardId}/access-requests`),
        ).requests;
        setRequests(pending);
        onRequests(pending.length);
      }
    } catch (caught) {
      setError(describe(caught));
    }
  }, [boardId, onRequests]);

  useEffect(() => {
    void requestsVersion;
    void load();
  }, [load, requestsVersion]);

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
        body: { identifier, role: newRole, duration: durationOf(newDuration) },
      });
      setIdentifier('');
    });
  };

  const updateBoard = (body: object) =>
    void act(() => api(`/boards/${boardId}`, { method: 'PATCH', body }));

  const role = data?.role;
  const roles = assignableRoles(role);

  return (
    <div className="board-members" role="dialog" aria-label="Membres du board">
      <div className="board-members-head">
        <h2>Membres et accès</h2>
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

          {requests.length > 0 && (
            <section className="board-members-requests" aria-label="Demandes d’accès">
              <h3>Demandes d’accès</h3>
              <ul>
                {requests.map((request) => (
                  <AccessRequestRow
                    key={request.id}
                    request={request}
                    roles={request.kind === 'guest' ? roles.filter(isGuestRole) : roles}
                    onDecide={(body) =>
                      void act(() =>
                        api(`/boards/${boardId}/access-requests/${request.id}`, {
                          method: 'POST',
                          body,
                        }),
                      )
                    }
                  />
                ))}
              </ul>
            </section>
          )}

          <fieldset className="board-members-access" disabled={!can(role, 'board.settings')}>
            <legend>Accès par lien ou code</legend>
            <label>
              <input
                type="radio"
                name="visibility"
                checked={data.visibility === 'public'}
                onChange={() => updateBoard({ visibility: 'public' })}
              />{' '}
              Session publique : entrée directe en
              <select
                aria-label="Rôle des non-membres"
                value={data.defaultRole}
                onChange={(event) => updateBoard({ defaultRole: event.target.value })}
              >
                {(Object.keys(DEFAULT_ROLE_LABELS) as DefaultRole[]).map((option) => (
                  <option key={option} value={option}>
                    {DEFAULT_ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="radio"
                name="visibility"
                checked={data.visibility === 'private'}
                onChange={() => updateBoard({ visibility: 'private' })}
              />{' '}
              Session privée : chaque demande doit être acceptée
            </label>
            <label>
              <input
                type="checkbox"
                checked={data.allowGuests}
                onChange={(event) => updateBoard({ allowGuests: event.target.checked })}
              />{' '}
              Accepter les invités sans compte
            </label>
          </fieldset>

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
                  {limitLabel(member) && (
                    <small className="board-members-limit"> · {limitLabel(member)}</small>
                  )}
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
            {data.guests.map((guest) => (
              <li key={guest.guestId}>
                <span>
                  {guest.displayName}
                  <small> · invité</small>
                  {limitLabel(guest) && (
                    <small className="board-members-limit"> · {limitLabel(guest)}</small>
                  )}
                </span>
                <span className="board-members-role">{ROLE_LABELS[guest.role]}</span>
                {can(role, 'board.members') && (
                  <span className="board-members-actions">
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        void act(() =>
                          api(`/boards/${boardId}/guests/${guest.guestId}`, { method: 'DELETE' }),
                        )
                      }
                    >
                      Retirer
                    </button>
                  </span>
                )}
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
              <DurationSelect
                label="Durée de l’accès"
                value={newDuration}
                onChange={setNewDuration}
              />
              <button type="submit">Ajouter</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

/** Un invité ne peut être que Viewer ou Editor. */
function isGuestRole(role: MemberRole): boolean {
  return role === 'viewer' || role === 'editor';
}

/** Demande d'accès : rôle et durée à accorder, ou refus. */
function AccessRequestRow({
  request,
  roles,
  onDecide,
}: {
  request: AccessRequest;
  roles: MemberRole[];
  onDecide: (
    body: { decision: 'accept'; role: MemberRole; duration: AccessDuration } | { decision: 'deny' },
  ) => void;
}) {
  const [role, setRole] = useState<MemberRole>(roles.includes('editor') ? 'editor' : 'viewer');
  const [duration, setDuration] = useState('permanent');
  return (
    <li>
      <span>
        {request.displayName}
        <small>{request.username ? ` @${request.username}` : ' · invité'}</small>
      </span>
      <span className="board-members-actions">
        <select
          aria-label={`Rôle accordé à ${request.displayName}`}
          value={role}
          onChange={(event) => setRole(event.target.value as MemberRole)}
        >
          {roles.map((option) => (
            <option key={option} value={option}>
              {ROLE_LABELS[option as BoardRole]}
            </option>
          ))}
        </select>
        <DurationSelect
          label={`Durée pour ${request.displayName}`}
          value={duration}
          onChange={setDuration}
        />
        <button
          type="button"
          onClick={() => onDecide({ decision: 'accept', role, duration: durationOf(duration) })}
        >
          Accepter
        </button>
        <button type="button" className="danger" onClick={() => onDecide({ decision: 'deny' })}>
          Refuser
        </button>
      </span>
    </li>
  );
}

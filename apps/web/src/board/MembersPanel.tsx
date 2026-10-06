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
import { Avatar, Badge, Button, Menu, MenuItem, Spinner } from '../ui/components';
import { Icon } from '../ui/Icon';

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
    <select
      className="select select-sm"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
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
    <aside className="drawer" aria-label="Membres et accès">
      <div className="drawer-head">
        <div>
          <h2>Membres et accès</h2>
          {role && <p className="muted">Votre rôle : {ROLE_LABELS[role]}</p>}
        </div>
        <Button variant="ghost" size="sm" icon="x" aria-label="Fermer" onClick={onClose} />
      </div>
      <div className="drawer-body">
        {error && <div className="alert alert-error">{error}</div>}
        {!data && !error && (
          <div className="page-loading">
            <Spinner />
          </div>
        )}
        {data && role && (
          <>
            {requests.length > 0 && (
              <section className="drawer-section" aria-label="Demandes d’accès">
                <h3>Demandes d’accès · {requests.length}</h3>
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
              </section>
            )}

            {can(role, 'board.settings') && (
              <section className="drawer-section">
                <h3>Accès par lien ou code</h3>
                <div className="access-options">
                  <label
                    className={`access-option${data.visibility === 'public' ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      checked={data.visibility === 'public'}
                      onChange={() => updateBoard({ visibility: 'public' })}
                    />
                    <span>
                      <strong>
                        <Icon name="globe" size={14} /> Session publique
                      </strong>
                      <small>Toute personne avec le lien ou le code entre directement.</small>
                      {data.visibility === 'public' && (
                        <select
                          className="select select-sm"
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
                      )}
                    </span>
                  </label>
                  <label
                    className={`access-option${data.visibility === 'private' ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      checked={data.visibility === 'private'}
                      onChange={() => updateBoard({ visibility: 'private' })}
                    />
                    <span>
                      <strong>
                        <Icon name="lock" size={14} /> Session privée
                      </strong>
                      <small>Chaque demande d’accès doit être acceptée.</small>
                    </span>
                  </label>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={data.allowGuests}
                    onChange={(event) => updateBoard({ allowGuests: event.target.checked })}
                  />
                  Accepter les invités sans compte
                </label>
              </section>
            )}

            {roles.length > 0 && (
              <section className="drawer-section">
                <h3>Inviter un membre</h3>
                <form className="add-member" onSubmit={add}>
                  <input
                    className="input board-members-identifier"
                    value={identifier}
                    placeholder="Nom d’utilisateur ou e-mail"
                    aria-label="Nom d’utilisateur ou e-mail"
                    autoComplete="off"
                    onChange={(event) => setIdentifier(event.target.value)}
                  />
                  <div className="add-member-row">
                    <select
                      className="select select-sm"
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
                    <Button type="submit" variant="primary" size="sm" icon="plus">
                      Ajouter
                    </Button>
                  </div>
                </form>
              </section>
            )}

            <section className="drawer-section">
              <h3>
                Membres · {data.members.length + (data.owner ? 1 : 0)}
                {data.guests.length > 0 && ` · invités · ${data.guests.length}`}
              </h3>
              <ul className="people-list">
                {data.owner && (
                  <li className="person">
                    <Avatar name={data.owner.displayName} />
                    <span className="person-text">
                      <strong>
                        {data.owner.displayName}
                        {data.owner.userId === selfId && <span className="subtle"> (vous)</span>}
                      </strong>
                      <small>@{data.owner.username}</small>
                    </span>
                    <Badge tone="primary">Owner</Badge>
                  </li>
                )}
                {data.members.map((member) => (
                  <li key={member.userId} className="person">
                    <Avatar name={member.displayName} />
                    <span className="person-text">
                      <strong>
                        {member.displayName}
                        {member.userId === selfId && <span className="subtle"> (vous)</span>}
                      </strong>
                      <small>
                        @{member.username}
                        {limitLabel(member) && (
                          <span className="limit"> · {limitLabel(member)}</span>
                        )}
                      </small>
                    </span>
                    <span className="person-actions">
                      {canManage(role, member.role) ? (
                        <select
                          className="select select-sm"
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
                        <Badge>{ROLE_LABELS[member.role]}</Badge>
                      )}
                      {(canManage(role, member.role) ||
                        member.userId === selfId ||
                        can(role, 'board.transfer')) && (
                        <Menu
                          trigger={(props) => (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon="more"
                              aria-label={`Actions pour ${member.displayName}`}
                              {...props}
                            />
                          )}
                        >
                          {can(role, 'board.transfer') && (
                            <MenuItem
                              icon="key"
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
                              Transférer la propriété
                            </MenuItem>
                          )}
                          {(canManage(role, member.role) || member.userId === selfId) && (
                            <MenuItem
                              icon={member.userId === selfId ? 'logout' : 'trash'}
                              danger
                              onClick={() =>
                                void act(() =>
                                  api(`/boards/${boardId}/members/${member.userId}`, {
                                    method: 'DELETE',
                                  }),
                                )
                              }
                            >
                              {member.userId === selfId ? 'Quitter le tableau' : 'Retirer'}
                            </MenuItem>
                          )}
                        </Menu>
                      )}
                    </span>
                  </li>
                ))}
                {data.guests.map((guest) => (
                  <li key={guest.guestId} className="person">
                    <Avatar name={guest.displayName} />
                    <span className="person-text">
                      <strong>{guest.displayName}</strong>
                      <small>
                        Invité
                        {limitLabel(guest) && <span className="limit"> · {limitLabel(guest)}</span>}
                      </small>
                    </span>
                    <span className="person-actions">
                      <Badge>{ROLE_LABELS[guest.role]}</Badge>
                      {can(role, 'board.members') && (
                        <Button
                          variant="danger-ghost"
                          size="sm"
                          icon="trash"
                          aria-label={`Retirer ${guest.displayName}`}
                          title="Retirer l’invité"
                          onClick={() =>
                            void act(() =>
                              api(`/boards/${boardId}/guests/${guest.guestId}`, {
                                method: 'DELETE',
                              }),
                            )
                          }
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </aside>
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
    <div className="request">
      <div className="request-head">
        <Avatar name={request.displayName} size="sm" />
        <span className="person-text">
          <strong>{request.displayName}</strong>
          <small>{request.username ? `@${request.username}` : 'Invité sans compte'}</small>
        </span>
      </div>
      <div className="request-controls">
        <select
          className="select select-sm"
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
      </div>
      <div className="request-buttons">
        <Button size="sm" variant="ghost" onClick={() => onDecide({ decision: 'deny' })}>
          Refuser
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon="check"
          onClick={() => onDecide({ decision: 'accept', role, duration: durationOf(duration) })}
        >
          Accepter
        </Button>
      </div>
    </div>
  );
}

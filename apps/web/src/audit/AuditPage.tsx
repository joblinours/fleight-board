import {
  type AuditCategory,
  AuditLogResponseSchema,
  type AuditRecord,
  BoardResponseSchema,
} from '@fleight/protocol';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, api } from '../auth/api';

/** Rafraîchissement de la première page en mode « suivre en direct ». */
const REFRESH_MS = 3000;
const PAGE_SIZE = 100;

/** Libellés des actions de l'audit. */
export const ACTION_LABELS: Record<AuditRecord['action'], string> = {
  'object.create': 'Création d’objet',
  'object.update': 'Modification d’objet',
  'object.delete': 'Suppression d’objet',
  'board.create': 'Création du board',
  'board.update': 'Réglages du board',
  'board.delete': 'Suppression du board',
  'board.transfer': 'Transfert de propriété',
  'board.member.add': 'Membre ajouté',
  'board.member.update': 'Rôle modifié',
  'board.member.remove': 'Membre retiré',
  'board.guest.join': 'Invité entré',
  'board.guest.remove': 'Invité retiré',
  'board.access.request': 'Demande d’accès',
  'board.access.accept': 'Accès accordé',
  'board.access.deny': 'Accès refusé',
  'auth.login': 'Connexion',
  'auth.login_failed': 'Connexion échouée',
  'auth.logout': 'Déconnexion',
  'auth.password_change': 'Mot de passe changé',
  'user.request': 'Demande de compte',
  'user.create': 'Compte créé',
  'user.update': 'Compte modifié',
  'user.delete': 'Compte supprimé',
  'user.password_reset': 'Mot de passe réinitialisé',
};

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  objects: 'Objets',
  board: 'Board',
  access: 'Membres et accès',
  accounts: 'Comptes',
};

const ACTOR_TYPES = { guest: 'invité', client: 'client', system: 'système' } as const;
const INTENTS = { undo: 'annulation', redo: 'rétablissement' } as const;

type Filters = {
  category: AuditCategory | '';
  q: string;
  actor: string;
  objectId: string;
  from: string;
  to: string;
  /** Audit global : périmètre et board. */
  scope: 'all' | 'accounts' | 'boards';
  boardId: string;
};

const EMPTY_FILTERS: Filters = {
  category: '',
  q: '',
  actor: '',
  objectId: '',
  from: '',
  to: '',
  scope: 'all',
  boardId: '',
};

/** Paramètres de requête des filtres (dates locales converties en instants). */
function queryString(filters: Filters, admin: boolean, before?: number): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (before !== undefined) params.set('before', String(before));
  if (filters.category) params.set('category', filters.category);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.actor) params.set('actor', filters.actor);
  if (filters.objectId) params.set('objectId', filters.objectId);
  if (filters.from) params.set('from', new Date(`${filters.from}T00:00`).toISOString());
  // Date de fin incluse : jusqu'au lendemain minuit.
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00`);
    end.setDate(end.getDate() + 1);
    params.set('to', end.toISOString());
  }
  if (admin) {
    params.set('scope', filters.scope);
    if (filters.boardId.trim()) params.set('boardId', filters.boardId.trim());
  }
  return params.toString();
}

/** Détails lisibles d'une entrée, selon son action. */
export function details(entry: AuditRecord): string {
  const meta = entry.metadata as Record<string, unknown> & AuditRecord['metadata'];
  const text = (key: string) => (typeof meta[key] === 'string' ? (meta[key] as string) : '');
  const parts: string[] = [];
  switch (entry.action) {
    case 'object.create':
    case 'object.update':
    case 'object.delete':
      if (meta.objectType) parts.push(meta.objectType);
      if (meta.fields?.length) parts.push(meta.fields.join(', '));
      if (meta.gestureId) parts.push('geste');
      break;
    case 'board.member.add':
      parts.push(`${text('memberName') || shortId(text('member'))} · ${text('role')}`);
      break;
    case 'board.member.update':
      parts.push(`${shortId(text('member'))} : ${text('from')} → ${text('to')}`);
      break;
    case 'board.member.remove':
      parts.push(`${shortId(text('member'))} (${text('role')})`);
      break;
    case 'board.access.accept':
      parts.push(`${text('requesterName')} · ${text('role')} · ${durationLabel(meta.duration)}`);
      break;
    case 'board.access.deny':
      parts.push(text('requesterName'));
      break;
    case 'board.guest.remove':
      parts.push(text('guestName'));
      break;
    case 'board.update':
      if (meta.changes && typeof meta.changes === 'object') {
        parts.push(Object.keys(meta.changes).join(', '));
      }
      break;
    case 'board.create':
    case 'board.delete':
      parts.push(text('name'));
      break;
    default:
      if (text('username')) parts.push(`@${text('username')}`);
  }
  if (meta.seq !== undefined) parts.push(`seq ${meta.seq}`);
  return parts.filter(Boolean).join(' · ');
}

function durationLabel(duration: unknown): string {
  const value = duration as { kind?: string; minutes?: number } | undefined;
  if (value?.kind === 'temporary') return `${value.minutes} min`;
  if (value?.kind === 'while-connected') return 'tant que connecté';
  return 'permanent';
}

/** Fin d'un identifiant (ULID) : suffisant pour distinguer les lignes. */
function shortId(id: string): string {
  return id.length > 8 ? `…${id.slice(-6)}` : id;
}

/** Fichier CSV des entrées chargées (séparateur `;`, guillemets doublés). */
function exportCsv(entries: AuditRecord[], name: string): void {
  const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [
    ['date', 'auteur', 'type', 'action', 'board', 'objet', 'détails'],
    ...entries.map((entry) => [
      entry.createdAt,
      entry.metadata.actorName ?? entry.actor,
      entry.actorType,
      entry.action,
      entry.boardId ?? '',
      entry.objectId ?? '',
      details(entry),
    ]),
  ];
  const blob = new Blob([`﻿${rows.map((row) => row.map(cell).join(';')).join('\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

type Page = { entries: AuditRecord[]; nextBefore: number | null };

/**
 * Consultation de l'audit, filtrable : celle d'un board (Co-owners, propriétaire,
 * Admins) ou l'audit global (Admins : comptes et tous les boards).
 */
function AuditView({ boardId }: { boardId?: string }) {
  const admin = boardId === undefined;
  const endpoint = admin ? '/admin/audit' : `/boards/${boardId}/audit`;
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [title, setTitle] = useState(admin ? 'Audit global' : `Audit — ${boardId}`);
  // Plus d'une page chargée : le suivi en direct remplacerait ce qui est affiché.
  const extended = useRef(false);

  useEffect(() => {
    if (!boardId) return;
    api(`/boards/${boardId}`)
      .then((data) => setTitle(`Audit — ${BoardResponseSchema.parse(data).board.name}`))
      .catch(() => {});
  }, [boardId]);

  const loadFirst = useCallback(async () => {
    try {
      const data = AuditLogResponseSchema.parse(
        await api(`${endpoint}?${queryString(filters, admin)}`),
      );
      setPage({ entries: data.entries, nextBefore: data.nextBefore ?? null });
      extended.current = false;
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Audit indisponible');
    }
  }, [endpoint, filters, admin]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (!extended.current) void loadFirst();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [live, loadFirst]);

  const loadMore = async () => {
    if (!page?.nextBefore) return;
    setLoadingMore(true);
    try {
      const data = AuditLogResponseSchema.parse(
        await api(`${endpoint}?${queryString(filters, admin, page.nextBefore)}`),
      );
      extended.current = true;
      setPage({
        entries: [...page.entries, ...data.entries],
        nextBefore: data.nextBefore ?? null,
      });
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Audit indisponible');
    } finally {
      setLoadingMore(false);
    }
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters(draft);
  };
  /** Filtre immédiat (clic sur un auteur ou un objet). */
  const refine = (changes: Partial<Filters>) => {
    const next = { ...filters, ...changes };
    setDraft(next);
    setFilters(next);
  };
  const active = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <main className="audit">
      <nav>
        <a href="#/">Accueil</a>
        {boardId ? (
          <a href={`#/board/${boardId}`}>Ouvrir le board</a>
        ) : (
          <a href="#/admin">Administration</a>
        )}
      </nav>
      <h1>{title}</h1>
      <p className="audit-help">
        Une ligne par opération finale (un tracé ou un déplacement = une ligne), annulations
        comprises, et par événement de gestion (membres, accès, réglages
        {admin ? ', comptes' : ''}). L’audit n’est jamais modifié ni annulé.
      </p>

      <form className="audit-filters" onSubmit={apply}>
        {admin && (
          <>
            <label className="audit-filter">
              Périmètre
              <select
                value={draft.scope}
                onChange={(event) =>
                  setDraft({ ...draft, scope: event.target.value as Filters['scope'] })
                }
              >
                <option value="all">Tout</option>
                <option value="boards">Boards</option>
                <option value="accounts">Comptes</option>
              </select>
            </label>
            <label className="audit-filter">
              Board
              <input
                value={draft.boardId}
                placeholder="identifiant"
                onChange={(event) => setDraft({ ...draft, boardId: event.target.value })}
              />
            </label>
          </>
        )}
        <label className="audit-filter">
          Famille
          <select
            value={draft.category}
            onChange={(event) =>
              setDraft({ ...draft, category: event.target.value as Filters['category'] })
            }
          >
            <option value="">Toutes</option>
            {(Object.keys(CATEGORY_LABELS) as AuditCategory[])
              .filter((category) => admin || category !== 'accounts')
              .map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
          </select>
        </label>
        <label className="audit-filter">
          Recherche
          <input
            type="search"
            value={draft.q}
            placeholder="auteur, objet…"
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          />
        </label>
        <label className="audit-filter">
          Du
          <input
            type="date"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </label>
        <label className="audit-filter">
          Au
          <input
            type="date"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <button type="submit">Filtrer</button>
        {active && (
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setFilters(EMPTY_FILTERS);
            }}
          >
            Réinitialiser
          </button>
        )}
      </form>

      <div className="audit-toolbar">
        {(filters.actor || filters.objectId) && (
          <span className="audit-chips">
            {filters.actor && (
              <button type="button" onClick={() => refine({ actor: '' })}>
                auteur {shortId(filters.actor)} ×
              </button>
            )}
            {filters.objectId && (
              <button type="button" onClick={() => refine({ objectId: '' })}>
                objet {shortId(filters.objectId)} ×
              </button>
            )}
          </span>
        )}
        <label>
          <input
            type="checkbox"
            checked={live}
            onChange={(event) => setLive(event.target.checked)}
          />{' '}
          Suivre en direct
        </label>
        <button
          type="button"
          disabled={!page?.entries.length}
          onClick={() => page && exportCsv(page.entries, admin ? 'audit' : `audit-${boardId}`)}
        >
          Exporter (CSV)
        </button>
      </div>

      {error && <p className="audit-error">{error}</p>}
      {!page && !error && <p>Chargement…</p>}
      {page && page.entries.length === 0 && (
        <p>Aucune entrée{active ? ' pour ces filtres' : ''}.</p>
      )}
      {page && page.entries.length > 0 && (
        <div className="audit-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Auteur</th>
                <th>Action</th>
                {admin && <th>Board</th>}
                <th>Objet</th>
                <th>Détails</th>
              </tr>
            </thead>
            <tbody>
              {page.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td>
                    <button
                      type="button"
                      className="audit-link"
                      title={`Filtrer sur cet auteur (${entry.actor})`}
                      onClick={() => refine({ actor: entry.actor })}
                    >
                      {entry.metadata.actorName ?? shortId(entry.actor)}
                    </button>
                    {entry.actorType !== 'user' && (
                      <span className="audit-actor-type">{ACTOR_TYPES[entry.actorType]}</span>
                    )}
                  </td>
                  <td>
                    {ACTION_LABELS[entry.action] ?? entry.action}
                    {entry.metadata.intent && (
                      <span className={`audit-intent ${entry.metadata.intent}`}>
                        {INTENTS[entry.metadata.intent]}
                      </span>
                    )}
                  </td>
                  {admin && (
                    <td>
                      {entry.boardId ? (
                        <a href={`#/audit/${entry.boardId}`}>{shortId(entry.boardId)}</a>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  <td>
                    {entry.objectId ? (
                      <button
                        type="button"
                        className="audit-link"
                        title={`Filtrer sur cet objet (${entry.objectId})`}
                        onClick={() => refine({ objectId: entry.objectId ?? '' })}
                      >
                        {shortId(entry.objectId)}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{details(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page?.nextBefore && (
        <p>
          <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Chargement…' : 'Entrées plus anciennes'}
          </button>
        </p>
      )}
    </main>
  );
}

/** Audit d'un board : Co-owners, propriétaire et Admins. */
export function AuditPage({ boardId }: { boardId: string }) {
  return <AuditView boardId={boardId} />;
}

/** Audit global : Admins. */
export function AdminAuditPage() {
  return <AuditView />;
}

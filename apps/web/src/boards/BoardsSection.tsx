import { can, ROLE_LABELS } from '@fleight/permissions';
import {
  type BoardCanvas,
  BoardCodeSchema,
  BoardResponseSchema,
  type BoardSummary,
  BoardsResponseSchema,
  CreateBoardRequestSchema,
  STANDARD_FORMATS,
  type StandardFormat,
  standardCanvas,
} from '@fleight/protocol';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiRequestError, api } from '../auth/api';
import { useSession } from '../auth/session';
import { PageHeader } from '../layout/AppShell';
import {
  Avatar,
  Badge,
  Button,
  colorFor,
  copyText,
  EmptyState,
  Field,
  Menu,
  MenuItem,
  Modal,
  Spinner,
  toast,
} from '../ui/components';
import { Icon } from '../ui/Icon';

const FORMATS: Array<{ value: StandardFormat | 'custom'; label: string }> = [
  { value: 'A4', label: 'A4' },
  { value: 'A3', label: 'A3' },
  { value: 'A2', label: 'A2' },
  { value: '16:9', label: '16:9 (écran)' },
  { value: '4:3', label: '4:3 (écran)' },
  { value: 'custom', label: 'Personnalisé' },
];

/** Libellé court du format d'un board. */
export function canvasLabel(canvas: BoardCanvas): string {
  if (canvas.kind === 'infinite') return 'Canvas infini';
  const size = `${canvas.width} × ${canvas.height}`;
  return canvas.format === 'custom' ? `Personnalisé · ${size}` : `${canvas.format} · ${size}`;
}

const relative = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

/** « il y a 5 minutes », « hier »… */
export function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'à l’instant';
}

function describe(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Erreur inattendue';
}

function shareLink(board: BoardSummary): string {
  return `${window.location.origin}${window.location.pathname}#/join/${board.code}`;
}

type Tab = 'all' | 'mine' | 'shared' | 'hidden';

/** Tableau de bord : boards possédés et partagés, création, rejoindre par code. */
export function BoardsSection() {
  const session = useSession();
  const userId = session.status === 'authenticated' ? session.user.id : undefined;
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<
    | { kind: 'create' }
    | { kind: 'join' }
    | { kind: 'rename'; board: BoardSummary }
    | { kind: 'delete'; board: BoardSummary }
    | null
  >(null);

  const load = useCallback(async () => {
    try {
      const data = await api('/boards?hidden=true');
      setBoards(BoardsResponseSchema.parse(data).boards);
    } catch (caught) {
      setError(describe(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: () => Promise<unknown>, done?: string) => {
    setError(null);
    try {
      await action();
      if (done) toast(done, 'check');
    } catch (caught) {
      setError(describe(caught));
    }
    await load();
  };

  const counts = useMemo(() => {
    const list = boards ?? [];
    return {
      all: list.filter((board) => !board.hidden).length,
      mine: list.filter((board) => !board.hidden && board.ownerId === userId).length,
      shared: list.filter((board) => !board.hidden && board.ownerId !== userId).length,
      hidden: list.filter((board) => board.hidden).length,
    };
  }, [boards, userId]);

  const visible = (boards ?? []).filter((board) => {
    if (tab === 'hidden' ? !board.hidden : board.hidden) return false;
    if (tab === 'mine' && board.ownerId !== userId) return false;
    if (tab === 'shared' && board.ownerId === userId) return false;
    const query = search.trim().toLowerCase();
    return (
      !query || `${board.name} ${board.description} ${board.code}`.toLowerCase().includes(query)
    );
  });

  const tabs: Array<[Tab, string]> = [
    ['all', 'Tous'],
    ['mine', 'Mes tableaux'],
    ['shared', 'Partagés avec moi'],
    ['hidden', 'Masqués'],
  ];

  return (
    <div className="page">
      <PageHeader
        title="Tableaux"
        subtitle="Vos whiteboards et ceux partagés avec vous."
        actions={
          <>
            <Button icon="hash" onClick={() => setModal({ kind: 'join' })}>
              Rejoindre par code
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setModal({ kind: 'create' })}>
              Nouveau tableau
            </Button>
          </>
        }
      />

      <div className="toolbar-row">
        <div className="tabs" role="tablist">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={`tab${tab === value ? ' active' : ''}`}
              onClick={() => setTab(value)}
            >
              {label}
              <span className="tab-count">{counts[value]}</span>
            </button>
          ))}
        </div>
        <div className="search">
          <Icon name="search" size={16} />
          <input
            className="input input-sm"
            type="search"
            placeholder="Rechercher un tableau…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {boards === null && !error && (
        <div className="page-loading">
          <Spinner />
        </div>
      )}
      {boards !== null && visible.length === 0 && (
        <EmptyState
          icon={tab === 'hidden' ? 'eyeOff' : 'layers'}
          title={
            search
              ? 'Aucun tableau ne correspond'
              : tab === 'hidden'
                ? 'Aucun tableau masqué'
                : tab === 'shared'
                  ? 'Rien n’est partagé avec vous pour l’instant'
                  : 'Créez votre premier tableau'
          }
          action={
            !search &&
            tab !== 'hidden' &&
            tab !== 'shared' && (
              <Button variant="primary" icon="plus" onClick={() => setModal({ kind: 'create' })}>
                Nouveau tableau
              </Button>
            )
          }
        >
          {!search && tab === 'shared'
            ? 'Rejoignez un tableau avec son code, ou demandez à être ajouté comme membre.'
            : !search && tab !== 'hidden'
              ? 'Un canvas infini ou une page au format A4, 16:9… pour dessiner et collaborer en temps réel.'
              : undefined}
        </EmptyState>
      )}

      <ul className="board-grid">
        {visible.map((board) => (
          <BoardCard
            key={board.id}
            board={board}
            isOwner={board.ownerId === userId}
            onRename={() => setModal({ kind: 'rename', board })}
            onToggleHidden={() =>
              act(
                () =>
                  api(`/boards/${board.id}`, { method: 'PATCH', body: { hidden: !board.hidden } }),
                board.hidden ? 'Tableau réaffiché' : 'Tableau masqué',
              )
            }
            onDelete={() => setModal({ kind: 'delete', board })}
          />
        ))}
      </ul>

      {modal?.kind === 'create' && <CreateBoardModal onClose={() => setModal(null)} />}
      {modal?.kind === 'join' && <JoinModal onClose={() => setModal(null)} />}
      {modal?.kind === 'rename' && (
        <RenameModal
          board={modal.board}
          onClose={() => setModal(null)}
          onSave={(changes) =>
            act(
              () => api(`/boards/${modal.board.id}`, { method: 'PATCH', body: changes }),
              'Tableau mis à jour',
            ).then(() => setModal(null))
          }
        />
      )}
      {modal?.kind === 'delete' && (
        <Modal
          title="Supprimer ce tableau ?"
          description={
            <>
              « {modal.board.name} » et tout son contenu seront supprimés définitivement. Les
              participants connectés seront déconnectés.
            </>
          }
          onClose={() => setModal(null)}
        >
          <div className="modal-actions">
            <Button onClick={() => setModal(null)}>Annuler</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={() =>
                void act(
                  () => api(`/boards/${modal.board.id}`, { method: 'DELETE' }),
                  'Tableau supprimé',
                ).then(() => setModal(null))
              }
            >
              Supprimer
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BoardCard({
  board,
  isOwner,
  onRename,
  onToggleHidden,
  onDelete,
}: {
  board: BoardSummary;
  isOwner: boolean;
  onRename: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  const accent = colorFor(board.id);
  return (
    <li className={`board-card${board.hidden ? ' is-hidden' : ''}`}>
      <a
        href={`#/board/${board.id}`}
        className="board-card-link"
        aria-label={`Ouvrir ${board.name}`}
      >
        <div
          className="board-thumb"
          style={{
            background: `radial-gradient(circle at 20% 20%, ${accent}33, transparent 55%), radial-gradient(circle at 85% 80%, ${accent}26, transparent 50%), var(--surface-2)`,
          }}
        >
          <span
            className={`board-thumb-page${board.canvas.kind === 'infinite' ? ' infinite' : ''}`}
            style={
              board.canvas.kind === 'standard'
                ? { aspectRatio: `${board.canvas.width} / ${board.canvas.height}` }
                : undefined
            }
          >
            <Icon name={board.canvas.kind === 'infinite' ? 'layers' : 'frame'} size={18} />
          </span>
        </div>
      </a>
      <div className="board-card-body">
        <div className="board-card-title">
          <a href={`#/board/${board.id}`}>{board.name}</a>
          <Menu
            trigger={(props) => (
              <Button variant="ghost" size="sm" icon="more" aria-label="Actions" {...props} />
            )}
          >
            <MenuItem icon="chevronRight" href={`#/board/${board.id}`}>
              Ouvrir
            </MenuItem>
            <MenuItem icon="link" onClick={() => void copyText(shareLink(board), 'Lien copié')}>
              Copier le lien de partage
            </MenuItem>
            <MenuItem icon="hash" onClick={() => void copyText(board.code, 'Code copié')}>
              Copier le code {board.code}
            </MenuItem>
            {can(board.role, 'board.audit') && (
              <MenuItem icon="history" href={`#/audit/${board.id}`}>
                Audit
              </MenuItem>
            )}
            {can(board.role, 'board.settings') && (
              <>
                <div className="divider" />
                <MenuItem icon="pencilLine" onClick={onRename}>
                  Renommer
                </MenuItem>
                <MenuItem icon={board.hidden ? 'eye' : 'eyeOff'} onClick={onToggleHidden}>
                  {board.hidden ? 'Réafficher' : 'Masquer'}
                </MenuItem>
              </>
            )}
            {can(board.role, 'board.delete') && (
              <MenuItem icon="trash" onClick={onDelete} danger>
                Supprimer
              </MenuItem>
            )}
          </Menu>
        </div>
        {board.description ? (
          <p className="board-card-description">{board.description}</p>
        ) : (
          <p className="board-card-description subtle">{canvasLabel(board.canvas)}</p>
        )}
        <div className="board-card-meta">
          {isOwner ? (
            <span className="subtle">Modifié {timeAgo(board.updatedAt)}</span>
          ) : (
            <span className="board-card-owner">
              <Avatar name={board.ownerName ?? '?'} size="sm" />
              <span className="subtle">{board.ownerName ?? 'Compte supprimé'}</span>
            </span>
          )}
          <span className="board-card-badges">
            {board.visibility === 'private' ? (
              <span title="Session privée" className="subtle">
                <Icon name="lock" size={14} />
              </span>
            ) : (
              <span title="Session publique" className="subtle">
                <Icon name="globe" size={14} />
              </span>
            )}
            {!isOwner && board.role && <Badge tone="primary">{ROLE_LABELS[board.role]}</Badge>}
            {board.hidden && <Badge>Masqué</Badge>}
          </span>
        </div>
      </div>
    </li>
  );
}

function RenameModal({
  board,
  onClose,
  onSave,
}: {
  board: BoardSummary;
  onClose: () => void;
  onSave: (changes: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  return (
    <Modal title="Renommer le tableau" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSave({ name: name.trim(), description: description.trim() });
        }}
      >
        <Field label="Nom">
          <input
            className="input"
            value={name}
            maxLength={80}
            // biome-ignore lint/a11y/noAutofocus: fenêtre ouverte à la demande de l'utilisateur
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Description">
          <textarea
            className="textarea"
            value={description}
            maxLength={500}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <div className="modal-actions">
          <Button onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary">
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function JoinModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsed = BoardCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError('Le code compte 6 caractères');
      return;
    }
    setBusy(true);
    try {
      const { board } = BoardResponseSchema.parse(await api(`/boards/code/${parsed.data}`));
      window.location.hash = `#/board/${board.id}`;
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Rejoindre un tableau"
      description="Saisissez le code à 6 caractères communiqué par son propriétaire."
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <input
          id="board-code"
          className="input input-code"
          value={code}
          placeholder="K7P4X2"
          maxLength={6}
          autoCapitalize="characters"
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: fenêtre ouverte à la demande de l'utilisateur
          autoFocus
          aria-label="Code du tableau"
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        {error && <div className="alert alert-error">{error}</div>}
        <div className="modal-actions">
          <Button onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={busy} iconRight="chevronRight">
            Rejoindre
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CreateBoardModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'infinite' | 'standard'>('infinite');
  const [format, setFormat] = useState<StandardFormat | 'custom'>('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [size, setSize] = useState({ width: '1920', height: '1080' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canvas = (): BoardCanvas => {
    if (kind === 'infinite') return { kind: 'infinite' };
    if (format === 'custom') {
      return {
        kind: 'standard',
        format: 'custom',
        width: Number(size.width),
        height: Number(size.height),
      };
    }
    return standardCanvas(format, orientation);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsed = CreateBoardRequestSchema.safeParse({ name, description, canvas: canvas() });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.path.includes('canvas')
          ? 'Dimensions entre 100 et 20 000 (entiers)'
          : (issue?.message ?? 'Formulaire invalide'),
      );
      return;
    }
    setBusy(true);
    try {
      const { board } = BoardResponseSchema.parse(
        await api('/boards', { method: 'POST', body: parsed.data }),
      );
      window.location.hash = `#/board/${board.id}`;
    } catch (caught) {
      setError(describe(caught));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nouveau tableau"
      description="Choisissez un nom et la surface de travail."
      onClose={onClose}
      wide
    >
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <Field label="Nom">
          <input
            className="input"
            value={name}
            maxLength={80}
            placeholder="Ex. : Architecture réseau"
            required
            // biome-ignore lint/a11y/noAutofocus: fenêtre ouverte à la demande de l'utilisateur
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Description" hint="Facultative">
          <textarea
            className="textarea"
            value={description}
            maxLength={500}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <div className="field">
          <span className="field-label">Surface</span>
          <div className="choice-grid">
            <button
              type="button"
              className={`choice${kind === 'infinite' ? ' selected' : ''}`}
              onClick={() => setKind('infinite')}
            >
              <Icon name="layers" size={20} />
              <strong>Canvas infini</strong>
              <span>Zoom et déplacement libres, sans limite.</span>
            </button>
            <button
              type="button"
              className={`choice${kind === 'standard' ? ' selected' : ''}`}
              onClick={() => setKind('standard')}
            >
              <Icon name="frame" size={20} />
              <strong>Page de taille fixe</strong>
              <span>A4, A3, 16:9… pour imprimer ou présenter.</span>
            </button>
          </div>
        </div>

        {kind === 'standard' && (
          <div className="form-row">
            <Field label="Format">
              <select
                className="select"
                value={format}
                onChange={(event) => {
                  const next = event.target.value as StandardFormat | 'custom';
                  setFormat(next);
                  // Orientation naturelle du format : portrait pour le papier, paysage pour l'écran.
                  if (next !== 'custom') {
                    const { width, height } = STANDARD_FORMATS[next];
                    setOrientation(height >= width ? 'portrait' : 'landscape');
                  }
                }}
              >
                {FORMATS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {format === 'custom' ? (
              <>
                <Field label="Largeur">
                  <input
                    className="input"
                    type="number"
                    min={100}
                    max={20000}
                    value={size.width}
                    onChange={(event) => setSize({ ...size, width: event.target.value })}
                  />
                </Field>
                <Field label="Hauteur">
                  <input
                    className="input"
                    type="number"
                    min={100}
                    max={20000}
                    value={size.height}
                    onChange={(event) => setSize({ ...size, height: event.target.value })}
                  />
                </Field>
              </>
            ) : (
              <Field label="Orientation">
                <select
                  className="select"
                  value={orientation}
                  onChange={(event) =>
                    setOrientation(event.target.value as 'portrait' | 'landscape')
                  }
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Paysage</option>
                </select>
              </Field>
            )}
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        <div className="modal-actions">
          <Button onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Créer et ouvrir
          </Button>
        </div>
      </form>
    </Modal>
  );
}

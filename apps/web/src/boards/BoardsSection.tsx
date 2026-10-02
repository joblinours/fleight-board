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
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../auth/api';

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
  if (canvas.kind === 'infinite') return 'Infini';
  const size = `${canvas.width} × ${canvas.height}`;
  return canvas.format === 'custom' ? `Personnalisé ${size}` : `${canvas.format} · ${size}`;
}

function describe(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Erreur inattendue';
}

/** Rejoindre par code, créer un board, et liste de ses boards. */
export function BoardsSection() {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api(`/boards${showHidden ? '?hidden=true' : ''}`);
      setBoards(BoardsResponseSchema.parse(data).boards);
    } catch (caught) {
      setError(describe(caught));
    }
  }, [showHidden]);

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

  return (
    <section className="boards">
      <JoinByCode />
      <CreateBoard />

      <div className="boards-head">
        <h2>Mes whiteboards</h2>
        <label>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />{' '}
          Afficher les boards masqués
        </label>
      </div>
      {error && <p className="boards-error">{error}</p>}
      {boards === null && <p>Chargement…</p>}
      {boards?.length === 0 && <p className="boards-empty">Aucun board pour l’instant.</p>}
      <ul className="boards-list">
        {boards?.map((board) => (
          <BoardCard
            key={board.id}
            board={board}
            onRename={(name) =>
              act(() => api(`/boards/${board.id}`, { method: 'PATCH', body: { name } }))
            }
            onToggleHidden={() =>
              act(() =>
                api(`/boards/${board.id}`, { method: 'PATCH', body: { hidden: !board.hidden } }),
              )
            }
            onDelete={() => {
              if (
                window.confirm(
                  `Supprimer définitivement « ${board.name} » et tout son contenu ? Les participants connectés seront déconnectés.`,
                )
              ) {
                void act(() => api(`/boards/${board.id}`, { method: 'DELETE' }));
              }
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function BoardCard({
  board,
  onRename,
  onToggleHidden,
  onDelete,
}: {
  board: BoardSummary;
  onRename: (name: string) => Promise<void>;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(board.name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && name.trim() !== board.name) await onRename(name.trim());
    setEditing(false);
  };

  return (
    <li className={board.hidden ? 'hidden-board' : undefined}>
      <div className="boards-card-head">
        {editing ? (
          <form onSubmit={(event) => void submit(event)}>
            <input
              value={name}
              maxLength={80}
              // biome-ignore lint/a11y/noAutofocus: champ ouvert à la demande de l'utilisateur
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit">OK</button>
          </form>
        ) : (
          <a href={`#/board/${board.id}`} className="boards-name">
            {board.name}
          </a>
        )}
        <span className="boards-code" title="Code pour rejoindre">
          {board.code}
        </span>
      </div>
      {board.description && <p className="boards-description">{board.description}</p>}
      <p className="boards-meta">
        {canvasLabel(board.canvas)} · modifié le {new Date(board.updatedAt).toLocaleString()}
        {board.hidden && ' · masqué'}
      </p>
      <div className="boards-actions">
        <a href={`#/board/${board.id}`}>Ouvrir</a>
        <button type="button" onClick={() => setEditing(!editing)}>
          Renommer
        </button>
        <button type="button" onClick={onToggleHidden}>
          {board.hidden ? 'Réafficher' : 'Masquer'}
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Supprimer
        </button>
      </div>
    </li>
  );
}

function JoinByCode() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsed = BoardCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError('Code à 6 caractères');
      return;
    }
    try {
      const { board } = BoardResponseSchema.parse(await api(`/boards/code/${parsed.data}`));
      window.location.hash = `#/board/${board.id}`;
    } catch (caught) {
      setError(describe(caught));
    }
  };

  return (
    <form className="boards-join" onSubmit={(event) => void submit(event)}>
      <label htmlFor="board-code">Rejoindre un board</label>
      <div>
        <input
          id="board-code"
          value={code}
          placeholder="CODE"
          maxLength={6}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        <button type="submit">Rejoindre</button>
      </div>
      {error && <p className="boards-error">{error}</p>}
    </form>
  );
}

function CreateBoard() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'infinite' | 'standard'>('infinite');
  const [format, setFormat] = useState<StandardFormat | 'custom'>('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [size, setSize] = useState({ width: '1920', height: '1080' });
  const [error, setError] = useState<string | null>(null);

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
    try {
      const { board } = BoardResponseSchema.parse(
        await api('/boards', { method: 'POST', body: parsed.data }),
      );
      window.location.hash = `#/board/${board.id}`;
    } catch (caught) {
      setError(describe(caught));
    }
  };

  if (!open) {
    return (
      <p>
        <button type="button" className="boards-new" onClick={() => setOpen(true)}>
          + Nouveau whiteboard
        </button>
      </p>
    );
  }

  return (
    <form className="boards-create" onSubmit={(event) => void submit(event)}>
      <h2>Nouveau whiteboard</h2>
      <label>
        Nom
        <input
          value={name}
          maxLength={80}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Description (facultative)
        <textarea
          value={description}
          maxLength={500}
          rows={2}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <fieldset>
        <legend>Canvas</legend>
        <label>
          <input
            type="radio"
            name="kind"
            checked={kind === 'infinite'}
            onChange={() => setKind('infinite')}
          />{' '}
          Infini
        </label>
        <label>
          <input
            type="radio"
            name="kind"
            checked={kind === 'standard'}
            onChange={() => setKind('standard')}
          />{' '}
          Page de taille fixe
        </label>
        {kind === 'standard' && (
          <div className="boards-format">
            <select
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
            {format === 'custom' ? (
              <>
                <input
                  type="number"
                  min={100}
                  max={20000}
                  value={size.width}
                  aria-label="Largeur"
                  onChange={(event) => setSize({ ...size, width: event.target.value })}
                />
                ×
                <input
                  type="number"
                  min={100}
                  max={20000}
                  value={size.height}
                  aria-label="Hauteur"
                  onChange={(event) => setSize({ ...size, height: event.target.value })}
                />
              </>
            ) : (
              <select
                value={orientation}
                onChange={(event) => setOrientation(event.target.value as 'portrait' | 'landscape')}
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Paysage</option>
              </select>
            )}
          </div>
        )}
      </fieldset>
      {error && <p className="boards-error">{error}</p>}
      <div className="boards-actions">
        <button type="submit">Créer et ouvrir</button>
        <button type="button" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

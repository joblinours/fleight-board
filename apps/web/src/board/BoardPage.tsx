import { BoardEditor, type InputMode, type ToolName } from '@fleight/canvas';
import { CollaborationClient, type ConnectionStatus } from '@fleight/collaboration';
import {
  AssetResponseSchema,
  type BoardSummary,
  type Participant,
  type PresenceMode,
} from '@fleight/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshSession, useSession } from '../auth/session';
import { createImageCache } from './image-cache';
import { createLockService } from './lock-service';
import { PropertiesPanel } from './PropertiesPanel';
import { sampleDiagram } from './sample-diagram';
import { CloseCodes, connectWebSocket } from './websocket-transport';

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connexion…',
  joined: 'Connecté',
  closed: 'Hors ligne — reconnexion…',
};

const REJECTION_MESSAGES: Record<string, string> = {
  CONFLICT: 'modifiée(s) entre-temps par un autre participant',
  LOCKED: 'en cours de modification par un autre participant',
  INVALID_OPERATION: 'devenue(s) impossible(s)',
  NOT_JOINED: 'envoyée(s) hors session',
};

const TOOLS: Array<{ name: ToolName; label: string; key: string }> = [
  { name: 'select', label: 'Sélection', key: 'V' },
  { name: 'lasso', label: 'Lasso', key: 'Q' },
  { name: 'rectangle', label: 'Rectangle', key: 'R' },
  { name: 'ellipse', label: 'Ellipse', key: 'O' },
  { name: 'polygon', label: 'Polygone', key: 'G' },
  { name: 'text', label: 'Texte', key: 'T' },
  { name: 'line', label: 'Ligne', key: 'L' },
  { name: 'arrow', label: 'Flèche', key: 'A' },
  { name: 'connector', label: 'Connecteur', key: 'C' },
  { name: 'pen', label: 'Stylo', key: 'P' },
  { name: 'highlighter', label: 'Surligneur', key: 'H' },
  { name: 'eraser', label: 'Gomme', key: 'E' },
  { name: 'frame', label: 'Frame', key: 'F' },
];

const PRESENCE_KEY = 'fleight.presenceMode';

/** Mode de présence choisi précédemment (« cursor » par défaut). */
function storedPresenceMode(): PresenceMode {
  try {
    return localStorage.getItem(PRESENCE_KEY) === 'drawing' ? 'drawing' : 'cursor';
  } catch {
    return 'cursor';
  }
}

/** Whiteboard local (`board` absent) ou collaboratif. */
export function BoardPage({ board }: { board?: BoardSummary }) {
  const boardId = board?.id;
  // Page d'un canvas standard, lue une fois à l'ouverture (le format ne change pas).
  const pageRef = useRef(
    board?.canvas.kind === 'standard'
      ? { width: board.canvas.width, height: board.canvas.height }
      : undefined,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<BoardEditor | null>(null);

  const [tool, setTool] = useState<ToolName>('select');
  const [selectionSize, setSelectionSize] = useState(0);
  const [mode, setMode] = useState<InputMode>('auto');
  const [editingId, setEditingId] = useState<string | null>(null);
  // Incrémenté à chaque changement de vue pour repositionner l'éditeur de texte.
  const [viewVersion, setViewVersion] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [participants, setParticipants] = useState<readonly Participant[]>([]);
  const [presenceMode, setPresenceMode] = useState<PresenceMode>(storedPresenceMode);
  const [self, setSelf] = useState<string | undefined>();
  const clientRef = useRef<CollaborationClient | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [pending, setPending] = useState(0);
  /** Session terminée côté serveur : board supprimé (ou disparu). */
  const [ended, setEnded] = useState<string | null>(null);
  const session = useSession();
  // Nom indicatif : le serveur affiche celui du compte connecté.
  const userName = useRef('Invité');
  userName.current = session.status === 'authenticated' ? session.user.displayName : 'Invité';

  useEffect(() => {
    const container = containerRef.current;
    const sceneCanvas = sceneCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !sceneCanvas || !overlayCanvas) return;

    const client = boardId
      ? new CollaborationClient({
          boardId,
          name: userName.current,
          mode: storedPresenceMode(),
          onStatus: (value) => {
            setStatus(value);
            setSelf(clientRef.current?.connectionId);
          },
          onCursors: () => editorRef.current?.refresh(),
          onParticipants: (list) => {
            setParticipants(list);
            editorRef.current?.refresh();
          },
          onRejected: (code, count) =>
            setRejection(
              count > 1
                ? `${count} modifications n’ont pas pu être appliquées (${REJECTION_MESSAGES[code] ?? 'refusées'}) ; le board a été resynchronisé.`
                : `Une modification n’a pas pu être appliquée (${REJECTION_MESSAGES[code] ?? 'refusée'}) ; le board a été resynchronisé.`,
            ),
          onPending: setPending,
          onLocks: () => editorRef.current?.refresh(),
          onLockDenied: () =>
            setRejection('Cet objet est en cours de modification par un autre participant.'),
        })
      : undefined;
    clientRef.current = client ?? null;
    // Connexion perdue : la session a peut-être expiré ou été révoquée (retour à la connexion).
    const disconnect = client
      ? connectWebSocket(client, undefined, (code) => {
          if (code === CloseCodes.BoardDeleted) setEnded('Ce board vient d’être supprimé.');
          else if (code === CloseCodes.BoardNotFound) setEnded('Ce board n’existe plus.');
          else void refreshSession();
        })
      : undefined;

    const editor = new BoardEditor({
      sceneCanvas,
      overlayCanvas,
      images: createImageCache(() => editorRef.current?.redraw()),
      ...(pageRef.current ? { page: pageRef.current } : {}),
      ...(client
        ? {
            document: client.document,
            locks: createLockService(client),
            remoteCursors: function* () {
              for (const [connectionId, position] of client.cursors) {
                const participant = client.participants.find(
                  (current) => current.connectionId === connectionId,
                );
                if (participant?.mode === 'cursor') {
                  yield { ...position, name: participant.name, color: participant.color };
                }
              }
            },
            onPointerMove: (position) => client.moveCursor(position),
            sink: {
              apply: (operations, gesture, intent) =>
                client.applyLocal(operations, gesture, intent),
              endGesture: (gestureId) => client.endGesture(gestureId),
            },
          }
        : {}),
      onEditText: setEditingId,
      onToolChange: setTool,
      onSelectionChange: (ids) => {
        setSelectionSize(ids.size);
        // Le panneau de propriétés suit la sélection, même de taille identique.
        setViewVersion((version) => version + 1);
      },
      onViewChange: () => setViewVersion((version) => version + 1),
      onHistoryChange: setHistory,
      onUndoSkipped: ({ applied, skipped, intent }) => {
        const action = intent === 'undo' ? 'Annulation' : 'Rétablissement';
        const count = skipped.length > 1 ? `${skipped.length} objets` : 'un objet';
        setRejection(
          applied
            ? `${action} partielle : ${count} supprimé(s) ou modifié(s) depuis par un autre participant.`
            : `${action} impossible : ${count} supprimé(s) ou modifié(s) depuis par un autre participant.`,
        );
      },
    });
    editorRef.current = editor;

    let sized = false;
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      editor.resize(width, height, window.devicePixelRatio || 1);
      // Canvas standard : la page entière est visible à l'ouverture.
      if (!sized && pageRef.current) editor.fitContent();
      sized = true;
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      disconnect?.();
      editor.dispose();
      editorRef.current = null;
      clientRef.current = null;
    };
  }, [boardId]);

  useEffect(() => {
    if (!rejection) return;
    const timer = window.setTimeout(() => setRejection(null), 4000);
    return () => window.clearTimeout(timer);
  }, [rejection]);

  useEffect(() => {
    if (editorRef.current) editorRef.current.inputMode = mode;
  }, [mode]);

  const changePresenceMode = (next: PresenceMode) => {
    setPresenceMode(next);
    clientRef.current?.setPresenceMode(next);
    try {
      localStorage.setItem(PRESENCE_KEY, next);
    } catch {
      // Préférence non mémorisée (navigation privée) : sans conséquence.
    }
  };

  // Focus de la zone de texte à l'ouverture de l'édition.
  useEffect(() => {
    if (!editingId) return;
    const textarea = textareaRef.current;
    textarea?.focus();
    textarea?.select();
  }, [editingId]);

  const commitText = useCallback(() => {
    const editor = editorRef.current;
    const textarea = textareaRef.current;
    if (editor && editingId && textarea) editor.commitText(editingId, textarea.value);
    setEditingId(null);
  }, [editingId]);

  const loadSample = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.replaceContent(sampleDiagram());
    editor.fitContent();
  };

  /** Importe une image (bouton, glisser-déposer, coller) et l'ajoute au centre de la vue. */
  const uploadImage = useCallback(
    async (file: File) => {
      const editor = editorRef.current;
      if (!editor || !boardId) return;
      if (!file.type.startsWith('image/')) {
        setRejection('Seules les images (PNG, JPEG, GIF, WebP) peuvent être importées.');
        return;
      }
      try {
        const response = await fetch(`/api/boards/${boardId}/assets`, {
          method: 'POST',
          headers: { 'content-type': file.type },
          body: file,
        });
        const data: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
          const message = (data as { message?: string } | undefined)?.message;
          setRejection(`Import impossible : ${message ?? `erreur ${response.status}`}`);
          return;
        }
        const { asset } = AssetResponseSchema.parse(data);
        editor.insertImage({ assetId: asset.id, width: asset.width, height: asset.height });
      } catch {
        setRejection('Import impossible : API injoignable.');
      }
    },
    [boardId],
  );

  // Coller une image depuis le presse-papiers.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      const file = [...(event.clipboardData?.files ?? [])].find(({ type }) =>
        type.startsWith('image/'),
      );
      if (file) {
        event.preventDefault();
        void uploadImage(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [uploadImage]);

  const frame = editingId ? editorRef.current?.textEditorFrame(editingId) : undefined;
  void viewVersion;

  return (
    <div
      className="board"
      ref={containerRef}
      role="application"
      aria-label="Whiteboard"
      onDragOver={(event) => {
        if (boardId && event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        const file = event.dataTransfer.files[0];
        if (!boardId || !file) return;
        event.preventDefault();
        void uploadImage(file);
      }}
    >
      <canvas ref={sceneCanvasRef} className="board-layer" />
      <canvas ref={overlayCanvasRef} className="board-layer" />

      {frame && editingId && (
        <textarea
          key={editingId}
          ref={textareaRef}
          className={`board-text-editor ${frame.align}`}
          defaultValue={frame.text}
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
            fontSize: frame.fontSize,
          }}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' ||
              (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
            ) {
              event.preventDefault();
              commitText();
            }
          }}
        />
      )}

      <div className="board-toolbar">
        {TOOLS.map(({ name, label, key }) => (
          <button
            key={name}
            type="button"
            className={tool === name ? 'active' : ''}
            title={`${label} (${key})`}
            onClick={() => editorRef.current?.setTool(name)}
          >
            {label}
          </button>
        ))}
        {boardId && (
          <label className="board-upload" title="Importer une image (ou glisser-déposer, coller)">
            Image
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void uploadImage(file);
              }}
            />
          </label>
        )}
        <span className="board-separator" />
        <button
          type="button"
          title="Annuler (Ctrl/⌘+Z)"
          disabled={!history.canUndo}
          onClick={() => editorRef.current?.undo()}
        >
          Annuler
        </button>
        <button
          type="button"
          title="Rétablir (Ctrl/⌘+Maj+Z)"
          disabled={!history.canRedo}
          onClick={() => editorRef.current?.redo()}
        >
          Rétablir
        </button>
        <button
          type="button"
          disabled={selectionSize === 0}
          onClick={() => editorRef.current?.deleteSelection()}
        >
          Supprimer
        </button>
        <button type="button" onClick={() => editorRef.current?.fitContent()}>
          Recadrer
        </button>
        <button type="button" onClick={loadSample}>
          Exemple
        </button>
        <select
          aria-label="Mode de saisie"
          value={mode}
          onChange={(event) => setMode(event.target.value as InputMode)}
        >
          <option value="auto">Auto</option>
          <option value="pencil-only">Pencil seul</option>
          <option value="touch-drawing">Doigt dessine</option>
        </select>
        <a href="#/">Accueil</a>
      </div>

      <PropertiesPanel editor={editorRef.current} tool={tool} />

      {boardId && (
        <div className="board-session">
          <span className={`board-status ${status ?? 'connecting'}`}>
            {STATUS_LABELS[status ?? 'connecting']}
          </span>
          {pending > 0 && status !== 'joined' && (
            <span className="board-pending">
              {pending} modification{pending > 1 ? 's' : ''} en attente
            </span>
          )}
          <span className="board-room">
            {board?.name} · code <strong>{board?.code}</strong>
          </span>
          <label className="board-presence">
            Présence
            <select
              value={presenceMode}
              onChange={(event) => changePresenceMode(event.target.value as PresenceMode)}
            >
              <option value="cursor">Cursor visible</option>
              <option value="drawing">Drawing only</option>
            </select>
          </label>
          <ul className="board-participants" aria-label="Participants">
            {participants.map(({ connectionId, name, color, mode: participantMode }) => (
              <li key={connectionId}>
                <span className="board-participant-dot" style={{ background: color }} />
                {name}
                {connectionId === self && <span className="board-participant-self"> (vous)</span>}
                <span
                  className="board-participant-mode"
                  title={participantMode === 'cursor' ? 'Cursor visible' : 'Drawing only'}
                >
                  {participantMode === 'cursor' ? 'curseur' : 'dessin seul'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ended && (
        <div className="board-ended" role="alert">
          <p>{ended}</p>
          <a href="#/">Retour à l’accueil</a>
        </div>
      )}

      {rejection && (
        <div className="board-toast" role="status">
          {rejection}
        </div>
      )}

      <p className="board-help">
        Double-tap / double-clic sur une forme pour éditer son texte (le titre d’une frame, le label
        d’un connecteur) · Glisser l’extrémité d’un connecteur sélectionné pour le reconnecter ·
        Glisser dans le vide pour sélectionner · Suppr pour supprimer · Échap pour revenir à la
        sélection
      </p>
    </div>
  );
}

import { BoardEditor, type InputMode, type ToolName } from '@fleight/canvas';
import { CollaborationClient, type ConnectionStatus } from '@fleight/collaboration';
import type { Participant } from '@fleight/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createLockService } from './lock-service';
import { sampleDiagram } from './sample-diagram';
import { connectWebSocket, displayName } from './websocket-transport';

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
  { name: 'rectangle', label: 'Rectangle', key: 'R' },
  { name: 'ellipse', label: 'Ellipse', key: 'O' },
  { name: 'text', label: 'Texte', key: 'T' },
  { name: 'connector', label: 'Connecteur', key: 'C' },
  { name: 'pen', label: 'Stylo', key: 'P' },
];
const COLORS = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#f59e0b'];

/** Whiteboard local (`boardId` absent) ou collaboratif. */
export function BoardPage({ boardId }: { boardId?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<BoardEditor | null>(null);

  const [tool, setTool] = useState<ToolName>('select');
  const [selectionSize, setSelectionSize] = useState(0);
  const [color, setColor] = useState(COLORS[0] ?? '#000');
  const [mode, setMode] = useState<InputMode>('auto');
  const [editingId, setEditingId] = useState<string | null>(null);
  // Incrémenté à chaque changement de vue pour repositionner l'éditeur de texte.
  const [viewVersion, setViewVersion] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [participants, setParticipants] = useState<readonly Participant[]>([]);
  const [rejection, setRejection] = useState<string | null>(null);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const sceneCanvas = sceneCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !sceneCanvas || !overlayCanvas) return;

    const client = boardId
      ? new CollaborationClient({
          boardId,
          name: displayName(),
          onStatus: setStatus,
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
    const disconnect = client ? connectWebSocket(client) : undefined;

    const editor = new BoardEditor({
      sceneCanvas,
      overlayCanvas,
      ...(client
        ? {
            document: client.document,
            locks: createLockService(client),
            sink: {
              apply: (operations, gesture, intent) =>
                client.applyLocal(operations, gesture, intent),
              endGesture: (gestureId) => client.endGesture(gestureId),
            },
          }
        : {}),
      onEditText: setEditingId,
      onToolChange: setTool,
      onSelectionChange: (ids) => setSelectionSize(ids.size),
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

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      editor.resize(width, height, window.devicePixelRatio || 1);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      disconnect?.();
      editor.dispose();
      editorRef.current = null;
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

  useEffect(() => {
    if (editorRef.current) editorRef.current.style.color = color;
  }, [color]);

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

  const frame = editingId ? editorRef.current?.textEditorFrame(editingId) : undefined;
  void viewVersion;

  return (
    <div className="board" ref={containerRef}>
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
        <span className="board-separator" />
        <div className="board-colors">
          {COLORS.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Couleur ${value}`}
              className={value === color ? 'selected' : ''}
              style={{ background: value }}
              onClick={() => setColor(value)}
            />
          ))}
        </div>
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
          <span className="board-room">Board « {boardId} »</span>
          <ul>
            {participants.map(({ connectionId, name }) => (
              <li key={connectionId}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {rejection && (
        <div className="board-toast" role="status">
          {rejection}
        </div>
      )}

      <p className="board-help">
        Double-tap / double-clic sur une forme pour éditer son texte · Suppr pour supprimer · Échap
        pour revenir à la sélection
      </p>
    </div>
  );
}

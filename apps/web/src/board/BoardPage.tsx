import { BoardEditor, type InputMode, type ToolName } from '@fleight/canvas';
import { CollaborationClient, type ConnectionStatus } from '@fleight/collaboration';
import { can, ROLE_LABELS } from '@fleight/permissions';
import {
  AssetResponseSchema,
  type BoardRole,
  type BoardSummary,
  type Participant,
  type PresenceMode,
} from '@fleight/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../auth/api';
import { refreshSession, useSession } from '../auth/session';
import { Avatar, Badge, Button, copyText, Menu, MenuItem, Modal, toast } from '../ui/components';
import { Icon, type IconName } from '../ui/Icon';
import { createImageCache } from './image-cache';
import { createLockService } from './lock-service';
import { MembersPanel } from './MembersPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { sampleDiagram } from './sample-diagram';
import { CloseCodes, connectWebSocket } from './websocket-transport';

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connexion…',
  waiting: 'En attente d’acceptation…',
  joined: 'Connecté',
  closed: 'Hors ligne — reconnexion…',
};

const REJECTION_MESSAGES: Record<string, string> = {
  CONFLICT: 'modifiée(s) entre-temps par un autre participant',
  LOCKED: 'en cours de modification par un autre participant',
  INVALID_OPERATION: 'devenue(s) impossible(s)',
  NOT_JOINED: 'envoyée(s) hors session',
  FORBIDDEN: 'non autorisée(s) pour votre rôle',
};

type ToolSpec = { name: ToolName; label: string; key: string; icon: IconName };

/** Outils, par groupes (séparés dans la barre d'outils). */
const TOOL_GROUPS: ToolSpec[][] = [
  [
    { name: 'select', label: 'Sélection', key: 'V', icon: 'pointer' },
    { name: 'lasso', label: 'Lasso', key: 'Q', icon: 'lasso' },
  ],
  [
    { name: 'pen', label: 'Stylo', key: 'P', icon: 'pen' },
    { name: 'highlighter', label: 'Surligneur', key: 'H', icon: 'highlighter' },
    { name: 'eraser', label: 'Gomme', key: 'E', icon: 'eraser' },
  ],
  [
    { name: 'rectangle', label: 'Rectangle', key: 'R', icon: 'square' },
    { name: 'ellipse', label: 'Ellipse', key: 'O', icon: 'circle' },
    { name: 'polygon', label: 'Polygone', key: 'G', icon: 'pentagon' },
    { name: 'text', label: 'Texte', key: 'T', icon: 'type' },
  ],
  [
    { name: 'line', label: 'Ligne', key: 'L', icon: 'line' },
    { name: 'arrow', label: 'Flèche', key: 'A', icon: 'arrow' },
    { name: 'connector', label: 'Connecteur', key: 'C', icon: 'connector' },
  ],
  [{ name: 'frame', label: 'Frame', key: 'F', icon: 'frame' }],
];

const INPUT_MODES: Array<{ value: InputMode; label: string; hint: string }> = [
  { value: 'auto', label: 'Automatique', hint: 'Stylet et souris dessinent, le doigt déplace' },
  { value: 'pencil-only', label: 'Pencil uniquement', hint: 'Seul l’Apple Pencil dessine' },
  { value: 'touch-drawing', label: 'Le doigt dessine', hint: 'Deux doigts pour déplacer' },
];

/** Raccourcis clavier affichés dans l'aide. */
const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl/⌘ + Z', 'Annuler'],
  ['Ctrl/⌘ + Maj + Z', 'Rétablir'],
  ['Ctrl/⌘ + C / X / V', 'Copier, couper, coller'],
  ['Ctrl/⌘ + D', 'Dupliquer'],
  ['Ctrl/⌘ + G', 'Grouper (Maj : dégrouper)'],
  ['Ctrl/⌘ + ] / [', 'Premier plan / arrière-plan'],
  ['Suppr', 'Supprimer la sélection'],
  ['Échap', 'Revenir à la sélection'],
  ['Double-clic', 'Éditer le texte, le titre ou le label'],
];

/** Message bref en bas de l'écran (refus, import impossible…). */
function notify(message: string): void {
  toast(message, 'bell');
}

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
export function BoardPage({
  board,
  guestName,
}: {
  board?: BoardSummary;
  /** Invité sans compte : son nom affiché (pas de gestion des membres). */
  guestName?: string;
}) {
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
  /** Rôle sur le board : celui de l'API à l'ouverture, puis celui de la session. */
  const [role, setRole] = useState<BoardRole | null>(board?.role ?? null);
  const [showMembers, setShowMembers] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Rôle lu une fois à l'ouverture ; la session le met ensuite à jour (onRole).
  const initialRoleRef = useRef(board?.role ?? null);
  const clientRef = useRef<CollaborationClient | null>(null);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [pending, setPending] = useState(0);
  /** Session terminée côté serveur : board supprimé (ou disparu). */
  const [ended, setEnded] = useState<string | null>(null);
  const session = useSession();
  // Nom indicatif : le serveur affiche celui du compte connecté.
  const userName = useRef('Invité');
  userName.current =
    guestName ?? (session.status === 'authenticated' ? session.user.displayName : 'Invité');
  /** Demandes d'accès en attente (Co-owners et propriétaire). */
  const [accessRequests, setAccessRequests] = useState(0);
  // Incrémenté à chaque nouvelle demande : le panneau des membres se recharge.
  const [requestsVersion, setRequestsVersion] = useState(0);

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
          onAccessRequests: (count) => {
            setAccessRequests(count);
            setRequestsVersion((current) => current + 1);
          },
          onRole: (next) => {
            setRole(next);
            if (editorRef.current) editorRef.current.readOnly = !can(next, 'board.edit');
          },
          onParticipants: (list) => {
            setParticipants(list);
            editorRef.current?.refresh();
          },
          onRejected: (code, count) =>
            notify(
              count > 1
                ? `${count} modifications n’ont pas pu être appliquées (${REJECTION_MESSAGES[code] ?? 'refusées'}) ; le board a été resynchronisé.`
                : `Une modification n’a pas pu être appliquée (${REJECTION_MESSAGES[code] ?? 'refusée'}) ; le board a été resynchronisé.`,
            ),
          onPending: setPending,
          onLocks: () => editorRef.current?.refresh(),
          onLockDenied: () =>
            notify('Cet objet est en cours de modification par un autre participant.'),
        })
      : undefined;
    clientRef.current = client ?? null;
    // Connexion perdue : la session a peut-être expiré ou été révoquée (retour à la connexion).
    const disconnect = client
      ? connectWebSocket(client, undefined, (code) => {
          if (code === CloseCodes.BoardDeleted) setEnded('Ce board vient d’être supprimé.');
          else if (code === CloseCodes.Forbidden)
            setEnded('Vous n’avez pas (ou plus) accès à ce board.');
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
        notify(
          applied
            ? `${action} partielle : ${count} supprimé(s) ou modifié(s) depuis par un autre participant.`
            : `${action} impossible : ${count} supprimé(s) ou modifié(s) depuis par un autre participant.`,
        );
      },
    });
    editorRef.current = editor;
    // Lecture seule tant que le rôle ne permet pas de modifier (rôle connu à l'ouverture).
    if (boardId) editor.readOnly = !can(initialRoleRef.current, 'board.edit');

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
    if (editorRef.current) editorRef.current.inputMode = mode;
  }, [mode]);

  // Co-owners et propriétaire : demandes déjà en attente à l'ouverture du board.
  useEffect(() => {
    if (!boardId || guestName || !can(role, 'board.members')) return;
    let cancelled = false;
    api<{ requests: unknown[] }>(`/boards/${boardId}/access-requests`)
      .then(({ requests }) => {
        if (!cancelled) setAccessRequests(requests.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [boardId, guestName, role]);

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
      if (guestName) {
        notify('L’import d’images est réservé aux comptes.');
        return;
      }
      if (!file.type.startsWith('image/')) {
        notify('Seules les images (PNG, JPEG, GIF, WebP) peuvent être importées.');
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
          notify(`Import impossible : ${message ?? `erreur ${response.status}`}`);
          return;
        }
        const { asset } = AssetResponseSchema.parse(data);
        editor.insertImage({ assetId: asset.id, width: asset.width, height: asset.height });
      } catch {
        notify('Import impossible : API injoignable.');
      }
    },
    [boardId, guestName],
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
  // Board local : tout est permis ; board partagé : selon le rôle.
  const canEdit = !boardId || can(role, 'board.edit');
  void viewVersion;

  const managing = !!boardId && !guestName;
  const others = participants.filter(({ connectionId }) => connectionId !== self);

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

      {/* Barre supérieure : retour, nom du board, statut, participants, partage. */}
      <header className="editor-topbar">
        <div className="editor-island">
          <a href="#/" className="btn btn-ghost btn-icon btn-sm" title="Retour aux tableaux">
            <Icon name="arrowLeft" size={17} />
          </a>
          <span className="editor-divider" />
          <div className="editor-title">
            <strong>{board?.name ?? 'Board local'}</strong>
            {board && (
              <span
                className="subtle"
                title={board.visibility === 'private' ? 'Session privée' : 'Session publique'}
              >
                <Icon name={board.visibility === 'private' ? 'lock' : 'globe'} size={14} />
              </span>
            )}
          </div>
          {boardId && status !== 'joined' && (
            <span className={`editor-status ${status ?? 'connecting'}`}>
              <span className="status-dot" />
              {STATUS_LABELS[status ?? 'connecting']}
              {pending > 0 && ` · ${pending} en attente`}
            </span>
          )}
          {!canEdit && (
            <Badge tone="warning" icon="eye">
              Lecture seule
            </Badge>
          )}
        </div>

        <div className="editor-island">
          {boardId && (
            <Menu
              trigger={(props) => (
                <button
                  type="button"
                  className="editor-people"
                  title="Participants et présence"
                  {...props}
                >
                  <span className="avatar-stack">
                    {participants.slice(0, 4).map(({ connectionId, name, color }) => (
                      <Avatar key={connectionId} name={name} color={color} size="sm" />
                    ))}
                  </span>
                  {participants.length > 4 && (
                    <span className="subtle">+{participants.length - 4}</span>
                  )}
                </button>
              )}
            >
              <div className="menu-label">
                {participants.length} participant{participants.length > 1 ? 's' : ''}
              </div>
              {participants.map(
                ({
                  connectionId,
                  name,
                  color,
                  mode: participantMode,
                  role: participantRole,
                  guest,
                }) => (
                  <div key={connectionId} className="people-row">
                    <Avatar name={name} color={color} size="sm" />
                    <span className="people-name">
                      {name}
                      {connectionId === self && <span className="subtle"> (vous)</span>}
                      <small className="subtle">
                        {ROLE_LABELS[participantRole]}
                        {guest ? ' · invité' : ''}
                        {participantMode === 'drawing' ? ' · dessin seul' : ''}
                      </small>
                    </span>
                  </div>
                ),
              )}
              <div className="divider" />
              <div className="menu-label">Votre présence</div>
              <MenuItem
                icon={presenceMode === 'cursor' ? 'check' : 'mousePointer'}
                onClick={() => changePresenceMode('cursor')}
              >
                Curseur visible
              </MenuItem>
              <MenuItem
                icon={presenceMode === 'drawing' ? 'check' : 'pen'}
                onClick={() => changePresenceMode('drawing')}
              >
                Dessins seulement
              </MenuItem>
            </Menu>
          )}
          {others.length === 0 && boardId && <span className="editor-alone subtle">Seul ici</span>}
          {board && (
            <Button
              variant="primary"
              size="sm"
              icon="share"
              onClick={() => void copyText(shareLink(board), `Lien copié · code ${board.code}`)}
              title={`Copier le lien de partage (code ${board.code})`}
            >
              Partager
            </Button>
          )}
          {managing && (
            <Button
              size="sm"
              icon="users"
              onClick={() => setShowMembers(!showMembers)}
              className={accessRequests > 0 ? 'has-badge' : undefined}
            >
              Membres
              {accessRequests > 0 && <span className="count-badge">{accessRequests}</span>}
            </Button>
          )}
          <Menu
            trigger={(props) => (
              <Button
                variant="ghost"
                size="sm"
                icon="more"
                aria-label="Plus d’options"
                {...props}
              />
            )}
          >
            {board && (
              <>
                <div className="menu-label">Code {board.code}</div>
                <MenuItem icon="hash" onClick={() => void copyText(board.code, 'Code copié')}>
                  Copier le code
                </MenuItem>
              </>
            )}
            {boardId && can(role, 'board.audit') && (
              <MenuItem icon="history" href={`#/audit/${boardId}`}>
                Audit du tableau
              </MenuItem>
            )}
            {canEdit && (
              <MenuItem icon="sparkles" onClick={loadSample}>
                Insérer le diagramme d’exemple
              </MenuItem>
            )}
            <div className="divider" />
            <div className="menu-label">Saisie</div>
            {INPUT_MODES.map((option) => (
              <MenuItem
                key={option.value}
                icon={mode === option.value ? 'check' : 'pencilLine'}
                onClick={() => setMode(option.value)}
              >
                {option.label}
              </MenuItem>
            ))}
            <div className="divider" />
            <MenuItem icon="key" onClick={() => setShowShortcuts(true)}>
              Raccourcis clavier
            </MenuItem>
          </Menu>
        </div>
      </header>

      {/* Outils, à gauche. */}
      <nav className="editor-toolrail" aria-label="Outils">
        {TOOL_GROUPS.map((group, index) => {
          const tools = group.filter(({ name }) => canEdit || name === 'select');
          if (!tools.length) return null;
          return (
            <div key={tools[0]?.name ?? index} className="toolrail-group">
              {tools.map(({ name, label, key, icon }) => (
                <button
                  key={name}
                  type="button"
                  className={`tool-button${tool === name ? ' active' : ''}`}
                  title={`${label} (${key})`}
                  aria-label={label}
                  aria-pressed={tool === name}
                  onClick={() => editorRef.current?.setTool(name)}
                >
                  <Icon name={icon} size={19} />
                </button>
              ))}
            </div>
          );
        })}
        {boardId && canEdit && !guestName && (
          <div className="toolrail-group">
            <label className="tool-button" title="Importer une image (ou glisser-déposer, coller)">
              <Icon name="image" size={19} />
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                aria-label="Importer une image"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void uploadImage(file);
                }}
              />
            </label>
          </div>
        )}
      </nav>

      {/* Historique et cadrage, en bas. */}
      <div className="editor-bottombar">
        {canEdit && (
          <div className="editor-island">
            <Button
              variant="ghost"
              size="sm"
              icon="undo"
              title="Annuler (Ctrl/⌘+Z)"
              aria-label="Annuler"
              disabled={!history.canUndo}
              onClick={() => editorRef.current?.undo()}
            />
            <Button
              variant="ghost"
              size="sm"
              icon="redo"
              title="Rétablir (Ctrl/⌘+Maj+Z)"
              aria-label="Rétablir"
              disabled={!history.canRedo}
              onClick={() => editorRef.current?.redo()}
            />
            {selectionSize > 0 && (
              <>
                <span className="editor-divider" />
                <Button
                  variant="danger-ghost"
                  size="sm"
                  icon="trash"
                  title="Supprimer la sélection (Suppr)"
                  aria-label="Supprimer la sélection"
                  onClick={() => editorRef.current?.deleteSelection()}
                />
              </>
            )}
          </div>
        )}
        <div className="editor-island">
          <Button
            variant="ghost"
            size="sm"
            icon="fit"
            title="Recadrer sur le contenu"
            onClick={() => editorRef.current?.fitContent()}
          >
            Recadrer
          </Button>
        </div>
      </div>

      {canEdit && !showMembers && <PropertiesPanel editor={editorRef.current} tool={tool} />}

      {showMembers && managing && (
        <MembersPanel
          boardId={boardId}
          selfId={session.status === 'authenticated' ? session.user.id : undefined}
          requestsVersion={requestsVersion}
          onRequests={setAccessRequests}
          onClose={() => setShowMembers(false)}
        />
      )}

      {accessRequests > 0 && !showMembers && (
        <button type="button" className="editor-requests" onClick={() => setShowMembers(true)}>
          <Icon name="bell" size={16} />
          {accessRequests === 1
            ? '1 demande d’accès en attente'
            : `${accessRequests} demandes d’accès en attente`}
        </button>
      )}

      {showShortcuts && (
        <Modal title="Raccourcis clavier" onClose={() => setShowShortcuts(false)}>
          <dl className="shortcuts">
            {TOOL_GROUPS.flat().map(({ name, label, key }) => (
              <div key={name}>
                <dt>
                  <kbd>{key}</kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
            {SHORTCUTS.map(([keys, label]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}

      {ended && (
        <div className="editor-ended" role="alert">
          <div className="card">
            <div className="card-body editor-ended-body">
              <span className="empty-icon">
                <Icon name="lock" size={22} />
              </span>
              <h2>Session terminée</h2>
              <p className="muted">{ended}</p>
              <a href="#/" className="btn btn-primary">
                Retour aux tableaux
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Lien de partage d'un board (entrée par code, compte ou invité). */
function shareLink(board: BoardSummary): string {
  return `${window.location.origin}${window.location.pathname}#/join/${board.code}`;
}

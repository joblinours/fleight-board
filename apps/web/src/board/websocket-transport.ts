import type { CollaborationClient } from '@fleight/collaboration';

/** URL du WebSocket de l'API (relayé par Vite en développement). */
export function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/** Fermetures définitives : session révoquée, board inexistant, board supprimé. */
export const CloseCodes = {
  Revoked: 4401,
  Forbidden: 4403,
  BoardNotFound: 4404,
  BoardDeleted: 4410,
} as const;
const FINAL_CLOSE_CODES = new Set<number>(Object.values(CloseCodes));

/** Délais de reconnexion successifs (ms) ; le dernier est répété. */
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];

/**
 * Relie le client de collaboration à un WebSocket et le reconnecte automatiquement
 * (délai croissant, et immédiatement au retour du réseau).
 * Retourne la fonction de fermeture définitive.
 */
export function connectWebSocket(
  client: CollaborationClient,
  url = websocketUrl(),
  /**
   * Appelé à chaque fermeture, avec le code reçu. Pour un board inexistant ou
   * supprimé, ou une session révoquée, il n'y a pas de reconnexion.
   */
  onClose?: (code: number) => void,
): () => void {
  let socket: WebSocket | undefined;
  let attempt = 0;
  let timer: number | undefined;
  let stopped = false;

  const open = () => {
    window.clearTimeout(timer);
    timer = undefined;
    if (stopped || socket) return;
    const current = new WebSocket(url);
    socket = current;
    current.addEventListener('open', () => {
      attempt = 0;
      client.connect({
        send: (message) => {
          if (current.readyState === WebSocket.OPEN) current.send(message);
        },
        close: () => current.close(),
      });
    });
    current.addEventListener('message', (event) => {
      if (typeof event.data === 'string') client.handleMessage(event.data);
    });
    current.addEventListener('close', (event) => {
      if (socket !== current) return;
      socket = undefined;
      client.handleClose();
      if (stopped) return;
      onClose?.(event.code);
      if (FINAL_CLOSE_CODES.has(event.code)) {
        stopped = true;
        return;
      }
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)] ?? 8000;
      attempt += 1;
      timer = window.setTimeout(open, delay);
    });
  };

  // Retour du réseau : inutile d'attendre la fin du délai.
  const onOnline = () => {
    attempt = 0;
    open();
  };
  // Coupure signalée par le navigateur : on ferme sans attendre le délai TCP.
  const onOffline = () => socket?.close();
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  open();

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    socket?.close();
  };
}

import type { CollaborationClient } from '@fleight/collaboration';

/** URL du WebSocket de l'API (relayé par Vite en développement). */
export function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/** Délais de reconnexion successifs (ms) ; le dernier est répété. */
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];

/**
 * Relie le client de collaboration à un WebSocket et le reconnecte automatiquement
 * (délai croissant, et immédiatement au retour du réseau).
 * Retourne la fonction de fermeture définitive.
 */
export function connectWebSocket(client: CollaborationClient, url = websocketUrl()): () => void {
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
    current.addEventListener('close', () => {
      if (socket !== current) return;
      socket = undefined;
      client.handleClose();
      if (stopped) return;
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

const NAME_KEY = 'fleight.displayName';

/** Nom affiché mémorisé localement (en attendant l'authentification). */
export function displayName(): string {
  try {
    const saved = window.localStorage.getItem(NAME_KEY);
    if (saved) return saved;
    const generated = `Invité ${Math.floor(1000 + Math.random() * 9000)}`;
    window.localStorage.setItem(NAME_KEY, generated);
    return generated;
  } catch {
    return `Invité ${Math.floor(1000 + Math.random() * 9000)}`;
  }
}

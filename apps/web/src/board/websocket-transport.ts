import type { CollaborationClient } from '@fleight/collaboration';

/** URL du WebSocket de l'API (relayé par Vite en développement). */
export function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/** Relie le client de collaboration à un WebSocket ; retourne la fonction de fermeture. */
export function connectWebSocket(client: CollaborationClient, url = websocketUrl()): () => void {
  const socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    client.connect({
      send: (message) => socket.send(message),
      close: () => socket.close(),
    });
  });
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') client.handleMessage(event.data);
  });
  socket.addEventListener('close', () => client.handleClose());
  return () => socket.close();
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

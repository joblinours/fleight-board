import { MeResponseSchema, type PublicUser } from '@fleight/protocol';
import { useSyncExternalStore } from 'react';
import { ApiRequestError, api } from './api';

export type Session =
  | { status: 'loading' }
  | { status: 'anonymous' }
  /** API injoignable : on ne sait pas si l'utilisateur est connecté. */
  | { status: 'offline' }
  | { status: 'authenticated'; user: PublicUser };

let session: Session = { status: 'loading' };
const listeners = new Set<() => void>();

function set(next: Session): void {
  session = next;
  for (const listener of listeners) listener();
}

/** Recharge l'utilisateur connecté depuis l'API. */
export async function refreshSession(): Promise<Session> {
  try {
    const { user } = MeResponseSchema.parse(await api('/auth/me'));
    set({ status: 'authenticated', user });
  } catch (error) {
    set(
      error instanceof ApiRequestError && error.status === 401
        ? { status: 'anonymous' }
        : { status: 'offline' },
    );
  }
  return session;
}

export function setSessionUser(user: PublicUser): void {
  set({ status: 'authenticated', user });
}

export async function logout(): Promise<void> {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  set({ status: 'anonymous' });
}

export function useSession(): Session {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => session,
  );
}

import { ApiErrorSchema } from '@fleight/protocol';

/** Erreur renvoyée par l'API (code stable, message lisible, champ en cause). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/** Appel JSON à l'API (relayée par Vite sous `/api`), cookie de session inclus. */
export async function api<T = unknown>(
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK', 'API injoignable — lancer ./scripts/dev.sh');
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(data);
    if (parsed.success) {
      throw new ApiRequestError(
        response.status,
        parsed.data.error,
        parsed.data.message,
        parsed.data.field,
      );
    }
    throw new ApiRequestError(response.status, 'HTTP_ERROR', `Erreur ${response.status}`);
  }
  return data as T;
}

import { isValid, ulid } from 'ulid';

/** Identifiant unique triable dans le temps (ULID, 26 caractères). */
export function createId(): string {
  return ulid();
}

export function isId(value: string): boolean {
  return isValid(value);
}

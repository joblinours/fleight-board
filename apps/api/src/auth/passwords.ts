import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id (`algorithm: 2`, l'enum du paquet n'étant pas importable ici),
 * paramètres recommandés par l'OWASP : 19 Mio, 2 itérations.
 */
const OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Hash factice vérifié quand l'identifiant est inconnu : la réponse prend le même
 * temps, ce qui ne révèle pas l'existence du compte.
 */
let dummyHash: Promise<string> | undefined;
export async function verifyDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Mot de passe temporaire lisible (sans caractères ambigus), ~90 bits d'entropie. */
export function temporaryPassword(): string {
  // Tirage par rejet : chaque caractère est équiprobable.
  const limit = 256 - (256 % ALPHABET.length);
  let result = '';
  while (result.length < 16) {
    for (const byte of randomBytes(32)) {
      if (byte < limit && result.length < 16) result += ALPHABET[byte % ALPHABET.length];
    }
  }
  return `${result.slice(0, 4)}-${result.slice(4, 8)}-${result.slice(8, 12)}-${result.slice(12, 16)}`;
}

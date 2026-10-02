import type { Operation } from '@fleight/protocol';

/**
 * Modification partielle d'un objet ; `id` et `type` ne changent jamais.
 * Le résultat est validé lors de l'application.
 */
export type ObjectPatch = Record<string, unknown>;

/** Opération sur le document, telle qu'elle circule dans le protocole. */
export type DocumentOperation = Operation;

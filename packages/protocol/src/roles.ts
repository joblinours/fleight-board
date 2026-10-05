import { z } from 'zod';

/**
 * Rôles sur un whiteboard, du plus faible au plus fort (cumulatifs).
 * Il n'y a pas de rôle Admin de whiteboard : l'Admin global agit comme un User.
 */
export const BOARD_ROLES = ['viewer', 'editor', 'presenter', 'co-owner', 'owner'] as const;
export const BoardRoleSchema = z.enum(BOARD_ROLES);
export type BoardRole = z.infer<typeof BoardRoleSchema>;

/** Rôles attribuables à un membre (la propriété se transfère, elle ne se délègue pas). */
export const MemberRoleSchema = z.enum(['viewer', 'editor', 'presenter', 'co-owner']);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

/**
 * Session publique : toute personne qui a le lien ou le code entre directement
 * (avec le rôle par défaut) ; privée : elle doit demander l'accès.
 */
export const BoardVisibilitySchema = z.enum(['public', 'private']);
export type BoardVisibility = z.infer<typeof BoardVisibilitySchema>;

/** Rôle des personnes qui entrent dans une session publique sans être membres. */
export const DefaultRoleSchema = z.enum(['viewer', 'editor']);
export type DefaultRole = z.infer<typeof DefaultRoleSchema>;

/** Rôles d'un invité (sans compte) : il ne gère jamais le board. */
export const GuestRoleSchema = z.enum(['viewer', 'editor']);
export type GuestRole = z.infer<typeof GuestRoleSchema>;

/** Durée maximale d'un accès temporaire : 30 jours, en minutes. */
export const MAX_ACCESS_MINUTES = 30 * 24 * 60;

/**
 * Durée d'un accès accordé : permanent, temporaire (en minutes), ou valable tant
 * que la personne qui l'accorde est connectée au board.
 */
export const AccessDurationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('permanent') }),
  z.object({
    kind: z.literal('temporary'),
    minutes: z.number().int().min(1).max(MAX_ACCESS_MINUTES),
  }),
  z.object({ kind: z.literal('while-connected') }),
]);
export type AccessDuration = z.infer<typeof AccessDurationSchema>;

/** Limites d'un accès : expiration, ou présence de la personne qui l'a accordé. */
export const AccessLimitSchema = z.object({
  expiresAt: z.string().nullable(),
  /** Accès valable tant que ce compte est connecté au board. */
  whileConnected: z.object({ userId: z.string(), displayName: z.string() }).nullable(),
});
export type AccessLimit = z.infer<typeof AccessLimitSchema>;

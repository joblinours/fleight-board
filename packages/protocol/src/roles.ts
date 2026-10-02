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
 * Accès d'un utilisateur connecté qui n'est pas membre (lien ou code) :
 * aucun (membres seulement), lecture ou édition.
 */
export const DefaultRoleSchema = z.enum(['none', 'viewer', 'editor']);
export type DefaultRole = z.infer<typeof DefaultRoleSchema>;

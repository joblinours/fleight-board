import { BOARD_ROLES, type BoardRole } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import {
  accessValid,
  assignableRoles,
  BOARD_ACTIONS,
  type BoardAction,
  can,
  canAssign,
  canChangeRole,
  canManage,
  effectiveRole,
} from './index';

/** Matrice attendue, écrite à la main : rôle → actions autorisées. */
const EXPECTED: Record<BoardRole, BoardAction[]> = {
  viewer: ['board.view'],
  editor: ['board.view', 'board.edit'],
  presenter: ['board.view', 'board.edit', 'board.present'],
  'co-owner': [
    'board.view',
    'board.edit',
    'board.present',
    'board.settings',
    'board.members',
    'board.audit',
  ],
  owner: Object.keys(BOARD_ACTIONS) as BoardAction[],
};

describe('matrice rôle → actions', () => {
  for (const role of BOARD_ROLES) {
    it(`${role}`, () => {
      const allowed = (Object.keys(BOARD_ACTIONS) as BoardAction[]).filter((action) =>
        can(role, action),
      );
      expect(allowed.sort()).toEqual([...EXPECTED[role]].sort());
    });
  }

  it('sans rôle, aucune action', () => {
    for (const action of Object.keys(BOARD_ACTIONS) as BoardAction[]) {
      expect(can(undefined, action)).toBe(false);
      expect(can(null, action)).toBe(false);
    }
  });

  it('les rôles sont cumulatifs : un rôle plus fort a au moins les droits du plus faible', () => {
    for (let i = 1; i < BOARD_ROLES.length; i++) {
      const weaker = EXPECTED[BOARD_ROLES[i - 1] as BoardRole];
      const stronger = EXPECTED[BOARD_ROLES[i] as BoardRole];
      expect(weaker.every((action) => stronger.includes(action))).toBe(true);
    }
  });
});

describe('délégation', () => {
  it('on ne délègue qu’un rôle au plus égal au sien, jamais Owner', () => {
    expect(assignableRoles('owner')).toEqual(['viewer', 'editor', 'presenter', 'co-owner']);
    expect(assignableRoles('co-owner')).toEqual(['viewer', 'editor', 'presenter', 'co-owner']);
    expect(assignableRoles('presenter')).toEqual([]);
    expect(assignableRoles('editor')).toEqual([]);
    expect(assignableRoles(undefined)).toEqual([]);
    expect(canAssign('owner', 'owner')).toBe(false);
    expect(canAssign('co-owner', 'co-owner')).toBe(true);
  });

  it('un Co-owner gère les membres jusqu’à son rôle, jamais l’Owner', () => {
    expect(canManage('co-owner', 'editor')).toBe(true);
    expect(canManage('co-owner', 'co-owner')).toBe(true);
    expect(canManage('co-owner', 'owner')).toBe(false);
    expect(canManage('owner', 'owner')).toBe(false);
    expect(canManage('presenter', 'viewer')).toBe(false);
    expect(canChangeRole('co-owner', 'viewer', 'presenter')).toBe(true);
    expect(canChangeRole('editor', 'viewer', 'editor')).toBe(false);
  });

  it('un Admin global propriétaire délègue au plus Co-owner', () => {
    // Le rôle global n'entre pas dans le calcul : l'Admin est un Owner comme un autre.
    const role = effectiveRole({ isOwner: true, visibility: 'private', defaultRole: 'viewer' });
    expect(role).toBe('owner');
    expect(assignableRoles(role).at(-1)).toBe('co-owner');
  });
});

describe('rôle effectif', () => {
  it('propriétaire, puis rôle de membre, puis rôle par défaut d’une session publique', () => {
    const base = { visibility: 'public' as const, defaultRole: 'editor' as const };
    expect(effectiveRole({ ...base, isOwner: true, memberRole: 'viewer' })).toBe('owner');
    // Un rôle de membre l'emporte, même plus faible que le rôle par défaut.
    expect(effectiveRole({ ...base, isOwner: false, memberRole: 'viewer' })).toBe('viewer');
    expect(effectiveRole({ ...base, isOwner: false })).toBe('editor');
  });

  it('session privée : un non-membre n’a aucun accès', () => {
    expect(
      effectiveRole({ isOwner: false, visibility: 'private', defaultRole: 'editor' }),
    ).toBeUndefined();
    expect(
      effectiveRole({
        isOwner: false,
        memberRole: 'editor',
        visibility: 'private',
        defaultRole: 'viewer',
      }),
    ).toBe('editor');
  });

  it('accès temporaire ou lié à la présence de celui qui l’a accordé', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    const connected = new Set(['host']);
    const isConnected = (id: string) => connected.has(id);
    expect(accessValid({ expiresAt: null, whileConnected: null }, { now, isConnected })).toBe(true);
    expect(
      accessValid(
        { expiresAt: new Date('2026-10-05T12:30:00Z'), whileConnected: null },
        { now, isConnected },
      ),
    ).toBe(true);
    expect(
      accessValid(
        { expiresAt: new Date('2026-10-05T11:59:00Z'), whileConnected: null },
        {
          now,
          isConnected,
        },
      ),
    ).toBe(false);
    expect(accessValid({ expiresAt: null, whileConnected: 'host' }, { now, isConnected })).toBe(
      true,
    );
    connected.clear();
    expect(accessValid({ expiresAt: null, whileConnected: 'host' }, { now, isConnected })).toBe(
      false,
    );
  });
});

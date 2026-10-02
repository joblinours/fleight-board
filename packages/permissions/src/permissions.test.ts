import { BOARD_ROLES, type BoardRole } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import {
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
    const role = effectiveRole({ isOwner: true, defaultRole: 'none' });
    expect(role).toBe('owner');
    expect(assignableRoles(role).at(-1)).toBe('co-owner');
  });
});

describe('rôle effectif', () => {
  it('propriétaire, puis rôle de membre, puis accès des non-membres', () => {
    expect(effectiveRole({ isOwner: true, memberRole: 'viewer', defaultRole: 'editor' })).toBe(
      'owner',
    );
    expect(effectiveRole({ isOwner: false, memberRole: 'viewer', defaultRole: 'editor' })).toBe(
      'viewer',
    );
    expect(effectiveRole({ isOwner: false, defaultRole: 'editor' })).toBe('editor');
    expect(effectiveRole({ isOwner: false, defaultRole: 'none' })).toBeUndefined();
  });
});

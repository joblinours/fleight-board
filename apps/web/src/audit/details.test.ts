import type { AuditRecord } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { details } from './AuditPage';

function entry(action: AuditRecord['action'], metadata: AuditRecord['metadata']): AuditRecord {
  return {
    id: 1,
    createdAt: '2026-10-05T12:00:00.000Z',
    actor: 'u1',
    actorType: 'user',
    action,
    boardId: 'b',
    objectId: null,
    sessionId: null,
    metadata,
  };
}

describe('détails de l’audit', () => {
  it('décrit chaque famille d’action lisiblement', () => {
    expect(details(entry('object.update', { seq: 4, fields: ['x', 'y'], gestureId: 'g' }))).toBe(
      'x, y · geste · seq 4',
    );
    expect(
      details(
        entry('board.access.accept', {
          requesterName: 'Zoé',
          role: 'viewer',
          duration: { kind: 'temporary', minutes: 60 },
        }),
      ),
    ).toBe('Zoé · viewer · 60 min');
    expect(
      details(
        entry('board.member.update', { member: '01ABCDEFGHJK', from: 'viewer', to: 'editor' }),
      ),
    ).toBe('…EFGHJK : viewer → editor');
    expect(details(entry('board.update', { changes: { name: 'x', visibility: 'private' } }))).toBe(
      'name, visibility',
    );
  });
});

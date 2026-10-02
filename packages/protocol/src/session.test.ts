import { describe, expect, it } from 'vitest';
import { ClientSessionMessageSchema, MAX_OPERATIONS_PER_BATCH } from './session';

describe('ClientSessionMessageSchema', () => {
  it('accepte un JOIN et refuse un boardId invalide', () => {
    expect(
      ClientSessionMessageSchema.safeParse({
        type: 'JOIN',
        boardId: 'demo-1',
        name: 'Alice',
        clientId: 'c1',
      }).success,
    ).toBe(true);
    expect(
      ClientSessionMessageSchema.safeParse({
        type: 'JOIN',
        boardId: '../etc',
        name: 'Alice',
        clientId: 'c1',
      }).success,
    ).toBe(false);
    expect(
      ClientSessionMessageSchema.safeParse({
        type: 'JOIN',
        boardId: 'demo',
        name: '   ',
        clientId: 'c1',
      }).success,
    ).toBe(false);
  });

  it('borne la taille d’un lot d’opérations', () => {
    const operation = { kind: 'delete', id: 'a' };
    const batch = (count: number) => ({
      type: 'OPS',
      batchId: 'b1',
      baseSeq: 0,
      operations: Array.from({ length: count }, () => operation),
    });
    expect(ClientSessionMessageSchema.safeParse(batch(1)).success).toBe(true);
    expect(ClientSessionMessageSchema.safeParse(batch(0)).success).toBe(false);
    expect(ClientSessionMessageSchema.safeParse(batch(MAX_OPERATIONS_PER_BATCH + 1)).success).toBe(
      false,
    );
  });

  it('valide les objets créés', () => {
    expect(
      ClientSessionMessageSchema.safeParse({
        type: 'OPS',
        batchId: 'b1',
        baseSeq: 0,
        operations: [{ kind: 'create', object: { type: 'rectangle', id: 'x' } }],
      }).success,
    ).toBe(false);
  });
});

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

describe('boards', () => {
  it('codes courts : 6 caractères sans O 0 I 1 S 5, insensibles à la casse', async () => {
    const { BoardCodeSchema, BOARD_CODE_ALPHABET } = await import('./boards');
    expect(BOARD_CODE_ALPHABET).toHaveLength(30);
    for (const ambiguous of 'O0I1S5') expect(BOARD_CODE_ALPHABET).not.toContain(ambiguous);
    expect(BoardCodeSchema.parse(' ab3x9k ')).toBe('AB3X9K');
    expect(BoardCodeSchema.safeParse('AB3X9O').success).toBe(false);
    expect(BoardCodeSchema.safeParse('AB3X9').success).toBe(false);
  });

  it('formats standard et orientation', async () => {
    const { standardCanvas } = await import('./boards');
    expect(standardCanvas('A4')).toEqual({
      kind: 'standard',
      format: 'A4',
      width: 794,
      height: 1123,
    });
    expect(standardCanvas('A4', 'landscape')).toMatchObject({ width: 1123, height: 794 });
    expect(standardCanvas('16:9')).toMatchObject({ width: 1920, height: 1080 });
    expect(standardCanvas('16:9', 'portrait')).toMatchObject({ width: 1080, height: 1920 });
  });
});

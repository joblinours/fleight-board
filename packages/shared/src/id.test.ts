import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId, isId } from './id';

describe('createId', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('génère des identifiants valides et uniques', () => {
    const ids = new Set(Array.from({ length: 1000 }, createId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(isId(id)).toBe(true);
  });

  it('génère des identifiants triables dans le temps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T20:00:00.000Z'));
    const first = createId();
    vi.setSystemTime(new Date('2026-10-01T20:00:00.001Z'));
    const second = createId();
    expect(first < second).toBe(true);
  });

  it('rejette une valeur invalide', () => {
    expect(isId('not-an-id')).toBe(false);
  });
});

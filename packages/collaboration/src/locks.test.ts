import { describe, expect, it } from 'vitest';
import { LockTable } from './locks';

function table() {
  let now = 0;
  const locks = new LockTable({ ttlMs: 1000, now: () => now });
  return { locks, advance: (ms: number) => (now += ms) };
}

describe('LockTable', () => {
  it('accorde un verrou et le refuse aux autres', () => {
    const { locks } = table();
    expect(locks.acquire('alice', ['a', 'b'])).toEqual({ ok: true });
    expect(locks.acquire('bob', ['b', 'c'])).toEqual({
      ok: false,
      holder: 'alice',
      objectIds: ['b'],
    });
    // Tout ou rien : c n'a pas été verrouillé pour Bob.
    expect(locks.holderOf('c')).toBeUndefined();
    // Redemander ses propres verrous les renouvelle.
    expect(locks.acquire('alice', ['a'])).toEqual({ ok: true });
  });

  it('libère les verrous de leur détenteur uniquement', () => {
    const { locks } = table();
    locks.acquire('alice', ['a', 'b']);
    expect(locks.release('bob', ['a'])).toEqual([]);
    expect(locks.release('alice', ['a'])).toEqual(['a']);
    expect(locks.releaseAll('alice')).toEqual(['b']);
    expect(locks.snapshot()).toEqual({});
  });

  it('fait expirer un verrou abandonné, sauf s’il est prolongé', () => {
    const { locks, advance } = table();
    locks.acquire('alice', ['a', 'b']);
    advance(800);
    locks.touch('alice', ['a']);
    locks.touch('bob', ['b']); // sans effet : Bob ne détient pas b
    advance(400);

    expect(locks.holderOf('a')).toBe('alice');
    expect(locks.holderOf('b')).toBeUndefined();
    expect(locks.acquire('bob', ['b'])).toEqual({ ok: true });
    expect(locks.expire()).toEqual([]);
    advance(2000);
    expect(locks.expire().sort()).toEqual(['a', 'b']);
  });

  it('retire les verrous des objets supprimés', () => {
    const { locks } = table();
    locks.acquire('alice', ['a']);
    expect(locks.remove(['a', 'z'])).toEqual(['a']);
    expect(locks.snapshot()).toEqual({});
  });
});

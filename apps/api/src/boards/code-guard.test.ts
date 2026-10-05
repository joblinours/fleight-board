import { describe, expect, it } from 'vitest';
import { CodeGuard } from './code-guard';

describe('CodeGuard', () => {
  it('bloque une adresse après trop de codes inexistants, puis la libère', () => {
    let now = 0;
    const guard = new CodeGuard({ maxFailures: 3, cooldownMs: 60_000, now: () => now });
    guard.failure('ip');
    guard.failure('ip');
    expect(guard.retryAfter('ip')).toBe(0);
    guard.failure('ip');
    expect(guard.retryAfter('ip')).toBe(60);
    expect(guard.retryAfter('autre')).toBe(0);
    now = 61_000;
    expect(guard.retryAfter('ip')).toBe(0);
  });

  it('un code valide remet le compteur à zéro ; les échecs anciens sont oubliés', () => {
    let now = 0;
    const guard = new CodeGuard({ maxFailures: 3, windowMs: 10_000, now: () => now });
    guard.failure('ip');
    guard.failure('ip');
    guard.success('ip');
    guard.failure('ip');
    guard.failure('ip');
    expect(guard.retryAfter('ip')).toBe(0);
    now = 20_000;
    guard.failure('ip');
    expect(guard.retryAfter('ip')).toBe(0);
  });
});

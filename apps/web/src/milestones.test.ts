import { describe, expect, it } from 'vitest';
import { MILESTONES } from './milestones';

describe('MILESTONES', () => {
  it('a une fiche par jalon, dans l’ordre, sans doublon', () => {
    const ids = MILESTONES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    // Mphase.numéro, triés par phase puis par numéro.
    const keys = ids.map((id) => {
      const [phase, number] = id.replace(/^M/, '').split('.').map(Number);
      return (phase ?? 0) * 1000 + (number ?? 0);
    });
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });

  it('pointe vers des routes existantes et décrit au moins une étape', () => {
    for (const milestone of MILESTONES) {
      expect(milestone.href).toMatch(
        /^#\/(bench|ink|admin(\/audit)?|account|board(\/[A-Za-z0-9_-]+)?|audit\/[A-Za-z0-9_-]+)?$/,
      );
      expect(milestone.steps.length).toBeGreaterThan(0);
    }
  });
});

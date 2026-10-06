import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const DATABASE_URL = 'postgres://fleight:secret@postgres:5432/fleight';

describe('configuration', () => {
  it('applique les valeurs par défaut', () => {
    const config = loadConfig({ DATABASE_URL });
    expect(config.PORT).toBe(3000);
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.WEB_DIR).toBeUndefined();
    expect(config.ADMIN_USERNAME).toBeUndefined();
  });

  it('traite une variable vide comme absente (docker-compose)', () => {
    const config = loadConfig({
      DATABASE_URL,
      ADMIN_USERNAME: '',
      ADMIN_PASSWORD: '',
      ADMIN_EMAIL: '',
      TRUST_PROXY: ' ',
    });
    expect(config.ADMIN_EMAIL).toBeUndefined();
    expect(config.ADMIN_USERNAME).toBeUndefined();
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('lit les réglages de production', () => {
    const config = loadConfig({
      DATABASE_URL,
      WEB_DIR: '/app/web',
      TRUST_PROXY: 'true',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'un-mot-de-passe-long',
    });
    expect(config.WEB_DIR).toBe('/app/web');
    expect(config.TRUST_PROXY).toBe(true);
    expect(config.ADMIN_USERNAME).toBe('admin');
  });

  it('refuse un Admin sans mot de passe et une base absente', () => {
    expect(() => loadConfig({ DATABASE_URL, ADMIN_USERNAME: 'admin' })).toThrow(/ADMIN_PASSWORD/);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});

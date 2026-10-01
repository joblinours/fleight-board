import { describe, expect, it } from 'vitest';
import { ClientHelloSchema } from './handshake';
import { PROTOCOL_VERSION } from './version';

describe('ClientHelloSchema', () => {
  it('accepte un HELLO valide', () => {
    const result = ClientHelloSchema.safeParse({
      type: 'HELLO',
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(result.success).toBe(true);
  });

  it('rejette un HELLO sans version', () => {
    expect(ClientHelloSchema.safeParse({ type: 'HELLO' }).success).toBe(false);
  });

  it('rejette un autre type de message', () => {
    expect(ClientHelloSchema.safeParse({ type: 'JOIN', protocolVersion: 1 }).success).toBe(false);
  });
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollaborationHub } from '@fleight/collaboration';
import { createId } from '@fleight/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { AssetService } from '../assets/asset-service';
import { FilesystemBlobStorage } from '../assets/blob-storage';
import { AuthService } from '../auth/auth-service';
import { hashPassword } from '../auth/passwords';
import { SESSION_COOKIE } from '../auth/routes';
import { connectDatabase, type Database } from '../database';
import { PostgresAuditLog } from '../db/audit-log';
import { PostgresBoardStore } from '../db/board-store';
import { users } from '../db/schema';
import { BoardService } from './board-service';

/** Tests sur un vrai PostgreSQL, ignorés sans TEST_DATABASE_URL (voir board-store.test.ts). */
const url = process.env.TEST_DATABASE_URL;
const PASSWORD = 'correct-horse-battery';
// PNG 1×1 transparent.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

describe.skipIf(!url)('membres et permissions', () => {
  let database: Database;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    database = connectDatabase(url as string);
    app = await buildApp({
      database: { ping: async () => true },
      auth: new AuthService(database.db),
      audit: new PostgresAuditLog(database.db),
      boards: new BoardService(database.db),
      assets: new AssetService(
        database.db,
        new FilesystemBlobStorage(await mkdtemp(join(tmpdir(), 'fleight-members-'))),
      ),
      createHub: (log) =>
        new CollaborationHub({
          log,
          store: new PostgresBoardStore(database.db),
          requireExistingBoards: true,
        }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  async function signIn(role: 'admin' | 'user' = 'user') {
    const username = `${role}-${createId().slice(-10).toLowerCase()}`;
    await database.db.insert(users).values({
      id: createId(),
      username,
      email: `${username}@example.test`,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
      role,
    });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      payload: { identifier: username, password: PASSWORD },
    });
    const token = login.cookies.find(({ name }) => name === SESSION_COOKIE)?.value as string;
    const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
      app.inject({
        method,
        url: path,
        cookies: { [SESSION_COOKIE]: token },
        ...(payload ? { payload } : {}),
      });
    return { id: login.json().user.id as string, username, token, request };
  }

  /** Board réservé à ses membres, avec un membre de chaque rôle demandé. */
  async function boardWith(roles: Array<'viewer' | 'editor' | 'presenter' | 'co-owner'>) {
    const owner = await signIn();
    const board = (await owner.request('POST', '/boards', { name: 'Équipe' })).json().board;
    await owner.request('PATCH', `/boards/${board.id}`, { visibility: 'private' });
    const members = [];
    for (const role of roles) {
      const member = await signIn();
      const added = await owner.request('POST', `/boards/${board.id}/members`, {
        identifier: member.username,
        role,
      });
      expect(added.statusCode).toBe(201);
      members.push(member);
    }
    return { owner, board, members };
  }

  it('ajout par nom ou e-mail ; le board partagé apparaît dans la liste avec le rôle', async () => {
    const owner = await signIn();
    const alice = await signIn();
    const bob = await signIn();
    const board = (await owner.request('POST', '/boards', { name: 'Partagé' })).json().board;
    expect(board).toMatchObject({ role: 'owner', defaultRole: 'editor' });

    await owner.request('POST', `/boards/${board.id}/members`, {
      identifier: alice.username,
      role: 'editor',
    });
    const byEmail = await owner.request('POST', `/boards/${board.id}/members`, {
      identifier: `${bob.username.toUpperCase()}@EXAMPLE.TEST`,
      role: 'viewer',
    });
    expect(byEmail.statusCode).toBe(201);
    expect(byEmail.json().members.map(({ role }: { role: string }) => role)).toEqual([
      'editor',
      'viewer',
    ]);

    const list = (await bob.request('GET', '/boards')).json().boards;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: board.id, role: 'viewer' });

    const again = await owner.request('POST', `/boards/${board.id}/members`, {
      identifier: alice.username,
      role: 'viewer',
    });
    expect(again.statusCode).toBe(409);
    const unknown = await owner.request('POST', `/boards/${board.id}/members`, {
      identifier: 'personne',
      role: 'viewer',
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('accès des non-membres : session publique (édition, lecture) ou privée', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const board = (await owner.request('POST', '/boards', { name: 'Accès' })).json().board;
    expect((await stranger.request('GET', `/boards/${board.id}`)).json().board.role).toBe('editor');

    await owner.request('PATCH', `/boards/${board.id}`, { defaultRole: 'viewer' });
    expect((await stranger.request('GET', `/boards/code/${board.code}`)).json().board.role).toBe(
      'viewer',
    );

    await owner.request('PATCH', `/boards/${board.id}`, { visibility: 'private' });
    expect((await stranger.request('GET', `/boards/${board.id}`)).statusCode).toBe(403);
    // Le code mène au board (pour demander l'accès), sans aucun droit.
    expect((await stranger.request('GET', `/boards/code/${board.code}`)).json().board.role).toBe(
      null,
    );
    expect((await stranger.request('GET', `/boards/${board.id}/members`)).statusCode).toBe(403);
  });

  it('matrice appliquée aux routes : réglages, membres, audit, suppression', async () => {
    const { owner, board, members } = await boardWith(['viewer', 'editor', 'co-owner']);
    const [viewer, editor, coOwner] = members as [
      Awaited<ReturnType<typeof signIn>>,
      Awaited<ReturnType<typeof signIn>>,
      Awaited<ReturnType<typeof signIn>>,
    ];
    expect((await viewer.request('GET', `/boards/${board.id}`)).statusCode).toBe(200);
    expect((await viewer.request('GET', `/boards/${board.id}/members`)).statusCode).toBe(200);
    expect(
      (await editor.request('PATCH', `/boards/${board.id}`, { name: 'Renommé' })).statusCode,
    ).toBe(403);
    expect(
      (await coOwner.request('PATCH', `/boards/${board.id}`, { name: 'Renommé' })).statusCode,
    ).toBe(200);
    expect((await editor.request('GET', `/boards/${board.id}/audit`)).statusCode).toBe(403);
    expect((await coOwner.request('GET', `/boards/${board.id}/audit`)).statusCode).toBe(200);
    expect((await coOwner.request('DELETE', `/boards/${board.id}`)).statusCode).toBe(403);
    expect((await owner.request('DELETE', `/boards/${board.id}`)).statusCode).toBe(204);
  });

  it('délégation : un rôle au plus égal au sien, jamais Owner ; pas de membre plus fort', async () => {
    const { owner, board, members } = await boardWith(['editor', 'co-owner']);
    const [editor, coOwner] = members as [
      Awaited<ReturnType<typeof signIn>>,
      Awaited<ReturnType<typeof signIn>>,
    ];
    const newcomer = await signIn();
    // Un Editor ne gère pas les membres.
    expect(
      (
        await editor.request('POST', `/boards/${board.id}/members`, {
          identifier: newcomer.username,
          role: 'viewer',
        })
      ).statusCode,
    ).toBe(403);
    // Owner n'est pas un rôle attribuable (la propriété se transfère).
    expect(
      (
        await owner.request('POST', `/boards/${board.id}/members`, {
          identifier: newcomer.username,
          role: 'owner',
        })
      ).statusCode,
    ).toBe(400);
    // Un Co-owner délègue jusqu'à Co-owner et modifie les membres de rôle inférieur ou égal.
    expect(
      (
        await coOwner.request('POST', `/boards/${board.id}/members`, {
          identifier: newcomer.username,
          role: 'co-owner',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await coOwner.request('PATCH', `/boards/${board.id}/members/${editor.id}`, {
          role: 'presenter',
        })
      ).statusCode,
    ).toBe(200);
    // Le propriétaire n'est pas un membre : personne ne le modifie ni ne le retire.
    expect(
      (await coOwner.request('DELETE', `/boards/${board.id}/members/${owner.id}`)).statusCode,
    ).toBe(404);
    // Chacun peut quitter un board.
    expect(
      (await editor.request('DELETE', `/boards/${board.id}/members/${editor.id}`)).statusCode,
    ).toBe(204);
    expect((await editor.request('GET', `/boards/${board.id}`)).statusCode).toBe(403);
  });

  it('un Admin global n’a pas de droit implicite sur les boards des autres', async () => {
    const { board } = await boardWith([]);
    const admin = await signIn('admin');
    expect((await admin.request('GET', `/boards/${board.id}`)).statusCode).toBe(403);
    // Il garde la lecture de l'audit (administration).
    expect((await admin.request('GET', `/boards/${board.id}/audit`)).statusCode).toBe(200);
  });

  it('transfert de propriété : réservé à l’Owner, l’ancien devient Co-owner', async () => {
    const { owner, board, members } = await boardWith(['co-owner']);
    const [coOwner] = members as [Awaited<ReturnType<typeof signIn>>];
    expect(
      (await coOwner.request('POST', `/boards/${board.id}/transfer`, { userId: coOwner.id }))
        .statusCode,
    ).toBe(403);
    const transferred = await owner.request('POST', `/boards/${board.id}/transfer`, {
      userId: coOwner.id,
    });
    expect(transferred.json().board).toMatchObject({ ownerId: coOwner.id, role: 'co-owner' });
    const membersAfter = (await coOwner.request('GET', `/boards/${board.id}/members`)).json();
    expect(membersAfter.owner.userId).toBe(coOwner.id);
    expect(membersAfter.members).toEqual([
      expect.objectContaining({ userId: owner.id, role: 'co-owner' }),
    ]);
    const audit = (await coOwner.request('GET', `/boards/${board.id}/audit`)).json().entries;
    expect(audit.map(({ action }: { action: string }) => action)).toContain('board.transfer');
  });

  it('import d’image : Editor au moins', async () => {
    const { board, members } = await boardWith(['viewer', 'editor']);
    const [viewer, editor] = members as [
      Awaited<ReturnType<typeof signIn>>,
      Awaited<ReturnType<typeof signIn>>,
    ];
    const upload = (member: Awaited<ReturnType<typeof signIn>>) =>
      app.inject({
        method: 'POST',
        url: `/boards/${board.id}/assets`,
        cookies: { [SESSION_COOKIE]: member.token },
        headers: { 'content-type': 'image/png' },
        payload: PNG,
      });
    expect((await upload(viewer)).statusCode).toBe(403);
    expect((await upload(editor)).statusCode).toBe(201);
  });

  it('WebSocket : Viewer en lecture seule, rôle changé en direct, membre retiré déconnecté', async () => {
    const { owner, board, members } = await boardWith(['viewer']);
    const [viewer] = members as [Awaited<ReturnType<typeof signIn>>];
    const connect = async (token: string) => {
      const socket = await app.injectWS('/ws', {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      });
      const messages: Array<Record<string, unknown>> = [];
      socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
      const closed = new Promise<number>((resolve) => socket.once('close', resolve));
      socket.send(JSON.stringify({ type: 'HELLO', protocolVersion: 1 }));
      socket.send(
        JSON.stringify({ type: 'JOIN', boardId: board.id, name: 'x', clientId: createId() }),
      );
      return { socket, messages, closed };
    };
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 10));
      expect(condition()).toBe(true);
    };

    const session = await connect(viewer.token);
    await until(() => session.messages.some(({ type }) => type === 'JOINED'));
    expect(session.messages.find(({ type }) => type === 'JOINED')).toMatchObject({
      role: 'viewer',
    });

    session.socket.send(
      JSON.stringify({
        type: 'OPS',
        batchId: 'b1',
        baseSeq: 0,
        operations: [
          {
            kind: 'create',
            object: {
              type: 'rectangle',
              id: 'r1',
              zIndex: 0,
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              fill: '#fff',
              stroke: '#000',
              strokeWidth: 1,
              label: '',
            },
          },
        ],
      }),
    );
    await until(() => session.messages.some(({ type }) => type === 'REJECT'));
    expect(session.messages.find(({ type }) => type === 'REJECT')).toMatchObject({
      code: 'FORBIDDEN',
    });

    await owner.request('PATCH', `/boards/${board.id}/members/${viewer.id}`, { role: 'editor' });
    await until(() =>
      session.messages.some(
        (message) =>
          message.type === 'PARTICIPANT_UPDATED' &&
          (message.participant as { role: string }).role === 'editor',
      ),
    );

    await owner.request('DELETE', `/boards/${board.id}/members/${viewer.id}`);
    expect(await session.closed).toBe(4403);

    // Sans accès, la connexion est refusée d'emblée.
    const refused = await connect(viewer.token);
    expect(await refused.closed).toBe(4403);
  });
});

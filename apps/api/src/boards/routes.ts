import {
  AddMemberRequestSchema,
  BoardCodeSchema,
  BoardIdSchema,
  type BoardMembersResponse,
  type BoardResponse,
  type BoardsResponse,
  CreateBoardRequestSchema,
  TransferBoardRequestSchema,
  UpdateBoardRequestSchema,
  UpdateMemberRequestSchema,
} from '@fleight/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Identity } from '../auth/auth-service';
import { parseBody } from '../auth/routes';
import type { AuditLogReader } from '../db/audit-log';
import { BoardError, type BoardService } from './board-service';

const ListQuerySchema = z.object({ hidden: z.enum(['true', 'false']).default('false') });
const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

/** Whiteboards : création, liste, code court, modification, suppression, audit. */
export async function registerBoards(
  app: FastifyInstance,
  {
    boards,
    audit,
    requireUser,
  }: {
    boards: BoardService;
    audit?: AuditLogReader | undefined;
    requireUser: preHandlerHookHandler;
  },
) {
  const user = { preHandler: requireUser };
  const identity = (request: FastifyRequest) => request.identity as Identity;
  /** Identifiant de board valide, ou réponse 404. */
  const boardId = (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = BoardIdSchema.safeParse((request.params as { id: string }).id);
    if (!parsed.success) void reply.code(404).send(notFound());
    return parsed.success ? parsed.data : undefined;
  };

  app.get('/boards', user, async (request, reply): Promise<BoardsResponse | undefined> => {
    const query = parseBody(ListQuerySchema, request.query, reply);
    if (!query) return;
    return {
      boards: await boards.list(identity(request), { includeHidden: query.hidden === 'true' }),
    };
  });

  app.post('/boards', user, async (request, reply) => {
    const body = parseBody(CreateBoardRequestSchema, request.body, reply);
    if (!body) return;
    const board = await boards.create(identity(request), body);
    return reply.code(201).send({ board } satisfies BoardResponse);
  });

  // Rejoindre par code : limité par IP pour empêcher l'énumération des codes.
  app.get(
    '/boards/code/:code',
    { ...user, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply): Promise<BoardResponse | undefined> => {
      const code = BoardCodeSchema.safeParse((request.params as { code: string }).code);
      if (!code.success) {
        return reply.code(404).send(notFound('Aucun board ne correspond à ce code'));
      }
      return { board: await boards.byCode(identity(request), code.data) };
    },
  );

  app.get('/boards/:id', user, async (request, reply): Promise<BoardResponse | undefined> => {
    const id = boardId(request, reply);
    if (!id) return;
    return { board: await boards.get(identity(request), id) };
  });

  app.patch('/boards/:id', user, async (request, reply): Promise<BoardResponse | undefined> => {
    const id = boardId(request, reply);
    const body = id && parseBody(UpdateBoardRequestSchema, request.body, reply);
    if (!id || !body) return;
    return { board: await boards.update(identity(request), id, body) };
  });

  app.delete('/boards/:id', user, async (request, reply) => {
    const id = boardId(request, reply);
    if (!id) return;
    await boards.delete(identity(request), id);
    return reply.code(204).send();
  });

  // Membres : lecture par tout participant, gestion par les Co-owners et le propriétaire.
  app.get(
    '/boards/:id/members',
    user,
    async (request, reply): Promise<BoardMembersResponse | undefined> => {
      const id = boardId(request, reply);
      if (!id) return;
      return boards.members(identity(request), id);
    },
  );

  app.post('/boards/:id/members', user, async (request, reply) => {
    const id = boardId(request, reply);
    const body = id && parseBody(AddMemberRequestSchema, request.body, reply);
    if (!id || !body) return;
    await boards.addMember(identity(request), id, body);
    return reply.code(201).send(await boards.members(identity(request), id));
  });

  app.patch('/boards/:id/members/:userId', user, async (request, reply) => {
    const id = boardId(request, reply);
    const body = id && parseBody(UpdateMemberRequestSchema, request.body, reply);
    if (!id || !body) return;
    const { userId } = request.params as { userId: string };
    await boards.updateMember(identity(request), id, userId, body.role);
    return boards.members(identity(request), id);
  });

  app.delete('/boards/:id/members/:userId', user, async (request, reply) => {
    const id = boardId(request, reply);
    if (!id) return;
    const { userId } = request.params as { userId: string };
    await boards.removeMember(identity(request), id, userId);
    return reply.code(204).send();
  });

  app.post('/boards/:id/transfer', user, async (request, reply) => {
    const id = boardId(request, reply);
    const body = id && parseBody(TransferBoardRequestSchema, request.body, reply);
    if (!id || !body) return;
    return { board: await boards.transfer(identity(request), id, body.userId) };
  });

  // Audit d'un board, du plus récent au plus ancien : Co-owners, propriétaire et Admins.
  if (audit) {
    app.get('/boards/:id/audit', user, async (request, reply) => {
      const id = boardId(request, reply);
      const query = id && parseBody(AuditQuerySchema, request.query, reply);
      if (!id || !query) return;
      if (!(await boards.canReadAudit(identity(request), id))) {
        throw new BoardError('FORBIDDEN', 'Réservé aux Co-owners, au propriétaire et aux Admins');
      }
      return { entries: await audit.list(id, query.limit) };
    });
  }
}

function notFound(message = 'Board introuvable') {
  return { error: 'BOARD_NOT_FOUND', message };
}

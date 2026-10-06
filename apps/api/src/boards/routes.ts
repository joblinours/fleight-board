import {
  type AccessRequestStatus,
  type AccessRequestsResponse,
  AddMemberRequestSchema,
  AuditQuerySchema,
  BoardCodeSchema,
  BoardIdSchema,
  type BoardMembersResponse,
  type BoardResponse,
  type BoardsResponse,
  CreateBoardRequestSchema,
  DecideAccessRequestSchema,
  GuestJoinRequestSchema,
  type GuestResponse,
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
import { CodeGuard } from './code-guard';
import { setGuestCookie } from './guest-auth';

const ListQuerySchema = z.object({ hidden: z.enum(['true', 'false']).default('false') });

/** Whiteboards : création, liste, code court, modification, suppression, audit. */
export async function registerBoards(
  app: FastifyInstance,
  {
    boards,
    audit,
    requireUser,
    requireUserOrGuest,
    codeGuard = new CodeGuard(),
  }: {
    boards: BoardService;
    audit?: AuditLogReader | undefined;
    requireUser: preHandlerHookHandler;
    /** Compte ou invité (cookie) : `request.identity` ou `request.guest`. */
    requireUserOrGuest: preHandlerHookHandler;
    codeGuard?: CodeGuard;
  },
) {
  const user = { preHandler: requireUser };
  const userOrGuest = { preHandler: requireUserOrGuest };

  /**
   * Recherche par code protégée : au-delà de trop de codes inexistants, l'adresse
   * doit attendre (429) ; un code valide remet son compteur à zéro.
   */
  const guarded = async <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    lookup: (code: string) => Promise<T>,
  ): Promise<T | undefined> => {
    const retryAfter = codeGuard.retryAfter(request.ip);
    if (retryAfter > 0) {
      void reply
        .code(429)
        .header('retry-after', String(retryAfter))
        .send({
          error: 'CODE_COOLDOWN',
          message: `Trop de codes invalides : réessayez dans ${Math.ceil(retryAfter / 60)} min`,
        });
      return undefined;
    }
    const code = BoardCodeSchema.safeParse((request.params as { code: string }).code);
    try {
      if (!code.success)
        throw new BoardError('BOARD_NOT_FOUND', 'Aucun board ne correspond à ce code');
      const result = await lookup(code.data);
      codeGuard.success(request.ip);
      return result;
    } catch (error) {
      if (error instanceof BoardError && error.code === 'BOARD_NOT_FOUND') {
        codeGuard.failure(request.ip);
      }
      throw error;
    }
  };
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
      const board = await guarded(request, reply, (code) => boards.byCode(identity(request), code));
      return board && { board };
    },
  );

  // Rejoindre sans compte (invité) : nom affiché, cookie limité à ce board.
  app.post(
    '/boards/code/:code/guest',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parseBody(GuestJoinRequestSchema, request.body, reply);
      if (!body) return;
      const joined = await guarded(request, reply, (code) => boards.joinAsGuest(code, body.name));
      if (!joined) return;
      setGuestCookie(request, reply, joined.token, joined.expiresAt);
      return reply
        .code(201)
        .send({ guest: joined.guest, board: joined.board } satisfies GuestResponse);
    },
  );

  // Invité de la session courante et son board.
  app.get('/guest', userOrGuest, async (request, reply): Promise<GuestResponse | undefined> => {
    const guest = request.guest;
    if (!guest)
      return reply.code(404).send({ error: 'NOT_GUEST', message: 'Pas de session invité' });
    return { guest, board: await boards.guestBoard(guest) };
  });

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

  // Session privée : demande d'accès, état de sa demande, décision des Co-owners.
  app.post(
    '/boards/:id/access-requests',
    user,
    async (request, reply): Promise<AccessRequestStatus | undefined> => {
      const id = boardId(request, reply);
      if (!id) return;
      return boards.requestAccess(identity(request), id);
    },
  );

  app.get(
    '/boards/:id/access-request',
    userOrGuest,
    async (request, reply): Promise<AccessRequestStatus | undefined> => {
      const id = boardId(request, reply);
      if (!id) return;
      const requester = request.guest
        ? { guestId: request.guest.id }
        : { userId: identity(request).userId };
      return boards.requestStatus(requester, id);
    },
  );

  app.get(
    '/boards/:id/access-requests',
    user,
    async (request, reply): Promise<AccessRequestsResponse | undefined> => {
      const id = boardId(request, reply);
      if (!id) return;
      return { requests: await boards.listRequests(identity(request), id) };
    },
  );

  app.post('/boards/:id/access-requests/:requestId', user, async (request, reply) => {
    const id = boardId(request, reply);
    const body = id && parseBody(DecideAccessRequestSchema, request.body, reply);
    if (!id || !body) return;
    const { requestId } = request.params as { requestId: string };
    await boards.decide(identity(request), id, requestId, body);
    return reply.code(204).send();
  });

  app.delete('/boards/:id/guests/:guestId', user, async (request, reply) => {
    const id = boardId(request, reply);
    if (!id) return;
    const { guestId } = request.params as { guestId: string };
    await boards.removeGuest(identity(request), id, guestId);
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
      return audit.query({ ...query, boardId: id });
    });
  }
}

function notFound(message = 'Board introuvable') {
  return { error: 'BOARD_NOT_FOUND', message };
}

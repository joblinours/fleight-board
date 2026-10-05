import { type AssetResponse, BoardIdSchema, IMAGE_MIME_TYPES } from '@fleight/protocol';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Identity } from '../auth/auth-service';
import type { AssetService } from './asset-service';

/** Import d'images dans un board, et lecture des fichiers importés. */
export async function registerAssets(
  app: FastifyInstance,
  {
    assets,
    requireUser,
    requireUserOrGuest,
    maxBytes,
  }: {
    assets: AssetService;
    requireUser: preHandlerHookHandler;
    /** Lecture : compte, ou invité (seulement les images de son board). */
    requireUserOrGuest?: preHandlerHookHandler;
    maxBytes: number;
  },
) {
  // Corps brut (le fichier) ; son type réel est vérifié par le service.
  app.addContentTypeParser(
    [...IMAGE_MIME_TYPES, 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: maxBytes },
    (_request, body, done) => done(null, body),
  );

  app.post(
    '/boards/:id/assets',
    { preHandler: requireUser, bodyLimit: maxBytes },
    async (request, reply) => {
      const boardId = BoardIdSchema.safeParse((request.params as { id: string }).id);
      if (!boardId.success) {
        return reply.code(404).send({ error: 'BOARD_NOT_FOUND', message: 'Board introuvable' });
      }
      if (!Buffer.isBuffer(request.body)) {
        return reply
          .code(415)
          .send({ error: 'UNSUPPORTED_IMAGE', message: 'Envoyez le fichier image brut' });
      }
      const asset = await assets.upload(identity(request), boardId.data, request.body);
      return reply.code(201).send({ asset } satisfies AssetResponse);
    },
  );

  app.get(
    '/assets/:id',
    { preHandler: requireUserOrGuest ?? requireUser },
    async (request, reply) => {
      const { asset, data } = await assets.read(
        (request.params as { id: string }).id,
        request.identity ? undefined : request.guest?.boardId,
      );
      return (
        reply
          .header('content-type', asset.mimeType)
          // Contenu immuable (un nouvel import a un nouvel identifiant).
          .header('cache-control', 'private, max-age=31536000, immutable')
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'")
          .header('content-disposition', 'inline')
          .send(data)
      );
    },
  );
}

function identity(request: FastifyRequest): Identity {
  return request.identity as Identity;
}

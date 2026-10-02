import { z } from 'zod';

/** Premier message envoyé par le client à l'ouverture du WebSocket. */
export const ClientHelloSchema = z.object({
  type: z.literal('HELLO'),
  protocolVersion: z.number().int().positive(),
});
export type ClientHello = z.infer<typeof ClientHelloSchema>;

/** Réponse du serveur quand la version du client est acceptée. */
export const ServerHelloSchema = z.object({
  type: z.literal('HELLO'),
  protocolVersion: z.number().int().positive(),
  connectionId: z.string(),
});
export type ServerHello = z.infer<typeof ServerHelloSchema>;

export const ServerErrorSchema = z.object({
  type: z.literal('ERROR'),
  code: z.enum(['INVALID_MESSAGE', 'UNSUPPORTED_PROTOCOL_VERSION', 'BOARD_NOT_FOUND', 'FORBIDDEN']),
  message: z.string(),
});
export type ServerError = z.infer<typeof ServerErrorSchema>;

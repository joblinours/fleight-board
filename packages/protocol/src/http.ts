import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  protocolVersion: z.number().int().positive(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

import { PasswordSchema, UsernameSchema } from '@fleight/protocol';
import { z } from 'zod';

const flag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const ConfigSchema = z
  .object({
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url(),
    /** Premier Admin, créé au démarrage s'il n'existe aucun Admin actif. */
    ADMIN_USERNAME: UsernameSchema.optional(),
    ADMIN_PASSWORD: PasswordSchema.optional(),
    ADMIN_EMAIL: z.email().optional(),
    /** Derrière un reverse proxy (HTTPS, IP réelle via X-Forwarded-*). */
    TRUST_PROXY: flag.default(false),
    /** Demandes de création de compte depuis l'interface. */
    ALLOW_REGISTRATION: flag.default(true),
    SESSION_TTL_DAYS: z.coerce.number().positive().default(30),
    SESSION_IDLE_DAYS: z.coerce.number().positive().default(7),
  })
  .refine((config) => !config.ADMIN_USERNAME === !config.ADMIN_PASSWORD, {
    message: 'ADMIN_USERNAME et ADMIN_PASSWORD vont ensemble',
    path: ['ADMIN_PASSWORD'],
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Configuration invalide :\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

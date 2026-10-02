import { z } from 'zod';

/** Identifiant de connexion : minuscules, chiffres, `.`, `_`, `-`. */
export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Au moins 3 caractères')
  .max(32, 'Au plus 32 caractères')
  .regex(/^[a-z0-9._-]+$/, 'Lettres, chiffres, « . », « _ » et « - » uniquement');

export const EmailSchema = z.email('Adresse e-mail invalide').trim().toLowerCase().max(254);

/** Longueur seule (recommandations NIST) : pas de règles de composition. */
export const PasswordSchema = z
  .string()
  .min(10, 'Au moins 10 caractères')
  .max(256, 'Au plus 256 caractères');

export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, 'Nom requis')
  .max(40, 'Au plus 40 caractères');

export const UserRoleSchema = z.enum(['admin', 'user']);
export type UserRole = z.infer<typeof UserRoleSchema>;

/** `pending` : demande de compte en attente de validation. */
export const UserStatusSchema = z.enum(['active', 'disabled', 'pending']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const LoginRequestSchema = z.object({
  /** Nom d'utilisateur ou adresse e-mail. */
  identifier: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Demande de création de compte, validée ensuite par un Admin. */
export const RegisterRequestSchema = z.object({
  username: UsernameSchema,
  email: EmailSchema.optional(),
  displayName: DisplayNameSchema,
  password: PasswordSchema,
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: PasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const CreateUserRequestSchema = z.object({
  username: UsernameSchema,
  email: EmailSchema.optional(),
  displayName: DisplayNameSchema,
  role: UserRoleSchema.default('user'),
  /** Absent : un mot de passe temporaire est généré (à changer à la connexion). */
  password: PasswordSchema.optional(),
});
export type CreateUserRequest = z.input<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z
  .object({
    displayName: DisplayNameSchema,
    email: EmailSchema.nullable(),
    role: UserRoleSchema,
    /** Activer, désactiver, ou valider une demande (`pending` → `active`). */
    status: z.enum(['active', 'disabled']),
  })
  .partial();
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

/** Utilisateur tel que l'API l'expose (jamais de hash de mot de passe). */
export const PublicUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  displayName: z.string(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const MeResponseSchema = z.object({ user: PublicUserSchema });
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const UsersResponseSchema = z.object({ users: z.array(PublicUserSchema) });
export type UsersResponse = z.infer<typeof UsersResponseSchema>;

/** Mot de passe temporaire, montré une seule fois à l'Admin. */
export const TemporaryPasswordResponseSchema = z.object({
  user: PublicUserSchema,
  temporaryPassword: z.string(),
});
export type TemporaryPasswordResponse = z.infer<typeof TemporaryPasswordResponseSchema>;

/** Erreur d'API : code stable pour le client, message lisible. */
export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  /** Champ en cause (formulaires). */
  field: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

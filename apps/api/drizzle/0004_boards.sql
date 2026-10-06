ALTER TABLE "boards" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "name" text;--> statement-breakpoint
-- Boards existants (créés implicitement en Phase 0) : nom = identifiant, code aléatoire.
UPDATE "boards" SET
  "name" = "id",
  "code" = (
    SELECT string_agg(substr('ABCDEFGHJKLMNPQRTUVWXYZ2346789', 1 + floor(random() * 30)::int, 1), '')
    FROM generate_series(1, 6 + 0 * length("boards"."id"))
  );--> statement-breakpoint
ALTER TABLE "boards" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "canvas" jsonb DEFAULT '{"kind":"infinite"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boards_code_idx" ON "boards" USING btree ("code");--> statement-breakpoint
CREATE INDEX "boards_owner_idx" ON "boards" USING btree ("owner_id");
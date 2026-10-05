CREATE TABLE "access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"user_id" text,
	"guest_id" text,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"display_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"role" text,
	"expires_at" timestamp with time zone NOT NULL,
	"while_connected" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_members" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "board_members" ADD COLUMN "while_connected" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "allow_guests" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_while_connected_users_id_fk" FOREIGN KEY ("while_connected") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_board_status_idx" ON "access_requests" USING btree ("board_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "guests_token_idx" ON "guests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guests_board_idx" ON "guests" USING btree ("board_id");--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_while_connected_users_id_fk" FOREIGN KEY ("while_connected") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Accès « membres seulement » (M1.7) : désormais une session privée.
UPDATE "boards" SET "visibility" = 'private', "default_role" = 'viewer' WHERE "default_role" = 'none';
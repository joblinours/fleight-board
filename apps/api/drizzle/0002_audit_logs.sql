CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"board_id" text NOT NULL,
	"object_id" text,
	"session_id" text,
	"metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_logs_board_created_idx" ON "audit_logs" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor","created_at");
CREATE TABLE "boards" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"board_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objects_board_id_id_pk" PRIMARY KEY("board_id","id")
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"board_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"actor" text NOT NULL,
	"gesture_id" text,
	"operations" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_board_id_seq_pk" PRIMARY KEY("board_id","seq")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"board_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"objects" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshots_board_id_seq_pk" PRIMARY KEY("board_id","seq")
);
--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operations_board_created_idx" ON "operations" USING btree ("board_id","created_at");
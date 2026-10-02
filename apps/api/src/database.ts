import { fileURLToPath } from 'node:url';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './db/schema';

export type Db = PostgresJsDatabase<typeof schema>;

export type Database = {
  db: Db;
  /** Vérifie que la base répond. */
  ping(): Promise<boolean>;
  /** Applique les migrations en attente. */
  migrate(): Promise<void>;
  close(): Promise<void>;
};

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export function connectDatabase(url: string): Database {
  const sql = postgres(url, { max: 10, connect_timeout: 5, onnotice: () => {} });
  const db = drizzle(sql, { schema });

  return {
    db,
    async ping() {
      try {
        await sql`select 1`;
        return true;
      } catch {
        return false;
      }
    },
    async migrate() {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

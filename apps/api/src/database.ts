import postgres from 'postgres';

export type Database = {
  /** Vérifie que la base répond. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
};

export function connectDatabase(url: string): Database {
  const sql = postgres(url, { max: 10, connect_timeout: 5 });

  return {
    async ping() {
      try {
        await sql`select 1`;
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

import { connectDatabase } from './database';

/**
 * Applique les migrations une fois avant les tests PostgreSQL : lancées en parallèle
 * par plusieurs fichiers sur une base neuve, elles se gêneraient (création concurrente
 * de la table des migrations).
 */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const database = connectDatabase(url);
  try {
    await database.migrate();
  } finally {
    await database.close();
  }
}

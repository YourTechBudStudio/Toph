import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { openDatabaseSync } from 'expo-sqlite';

import migrations from '../../drizzle/migrations';

export type TophDatabase = ExpoSQLiteDatabase;

let opening: Promise<TophDatabase> | undefined;

/**
 * The app's one database, opened and migrated once per JS runtime; Home and the keyboard's task share it.
 * A failure stays rejected until the app restarts: there is no retry.
 */
export function openDatabase(): Promise<TophDatabase> {
  opening ??= (async () => {
    const db = drizzle(openDatabaseSync('toph.db'));
    await migrate(db, migrations);
    return db;
  })();
  return opening;
}

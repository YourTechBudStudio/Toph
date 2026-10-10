# Database Schema

## Purpose

This document records where Toph's local database implementation lives. It intentionally does not duplicate the schema in Markdown; the Drizzle schema is the source of truth.

Desktop and mobile each have their own SQLite database built from one shared schema, `packages/dictation-core/src/db/schema.ts`. Each app generates its own migrations, so a schema change needs a new migration in both `apps/desktop/drizzle/` and `apps/mobile/drizzle/`.

## Desktop

### Storage

Toph stores local app data under the resolved data directory:

```text
TOPH_DATA_DIRECTORY, when set
$HOME/.toph, otherwise
```

The SQLite database file is:

```text
<dataDirectory>/data.db
```

Raw recordings are stored under:

```text
<dataDirectory>/recordings/
```

Data directory resolution lives in `apps/desktop/src/main/paths.ts`.

### Implementation

- SQLite driver: `better-sqlite3`
- Runtime store and migration wiring: `apps/desktop/src/main/stores/session-store.ts`
- Runtime migration folder resolution: `apps/desktop/src/main/bootstrap.ts`
- Drizzle Kit config: `apps/desktop/drizzle.config.ts`
- Generated migrations: `apps/desktop/drizzle/`

### Ownership

The desktop main process owns database access. Renderer code should use explicit desktop contracts rather than reading or writing SQLite directly.

## Mobile

Mobile writes only the tables that polish settings and history need. The database file is `toph.db` in `expo-sqlite`'s default location. Raw recordings are stored under `recordings/` in the app's private document directory, and rows store their paths relative to that directory because its absolute location can change between app updates.

- SQLite driver: `expo-sqlite`
- Database opening and migration: `apps/mobile/src/storage/database.ts`
- Drizzle Kit config: `apps/mobile/drizzle.config.ts` (`pnpm --filter @toph/mobile db:generate`)
- Generated migrations: `apps/mobile/drizzle/`
- Retention: `packages/dictation-core/src/db/retention.ts`, shared with desktop

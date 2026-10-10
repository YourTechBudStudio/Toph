import { defineConfig } from 'drizzle-kit';

// The schema is desktop's, shared through the core. Migrations here are mobile's own.
export default defineConfig({
  dialect: 'sqlite',
  driver: 'expo',
  schema: '../../packages/dictation-core/src/db/schema.ts',
  out: './drizzle',
});

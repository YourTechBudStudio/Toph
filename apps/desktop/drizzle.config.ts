import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: '../../packages/dictation-core/src/db/schema.ts',
  out: './drizzle',
});

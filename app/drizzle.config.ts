import type { Config } from 'drizzle-kit';

/**
 * Generates SQL migrations into migrations/, which `wrangler d1 migrations
 * apply` runs. Drizzle never talks to D1 directly here — wrangler owns that,
 * so local and deployed databases move through exactly the same files.
 */
export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
} satisfies Config;

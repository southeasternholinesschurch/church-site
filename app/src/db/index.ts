import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Db = ReturnType<typeof getDb>;

/** One place that knows how the binding is reached, so routes don't. */
export function getDb(env: { DB: D1Database }) {
  return drizzle(env.DB, { schema });
}

export { schema };
export const nowIso = () => new Date().toISOString();

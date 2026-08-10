import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * Database client — one Postgres dialect, two drivers (Session 03 decision):
 *
 * - `DATABASE_URL` set  → real Postgres via node-postgres (production/staging).
 *   Migrations are applied EXPLICITLY (`npm run db:migrate`) — the app never
 *   runs DDL against an external database at request time.
 * - `DATABASE_URL` unset → embedded PGlite (WASM Postgres) at
 *   `PGLITE_DATA_DIR` (default `.data/pglite`; `memory://` for tests).
 *   Pending migrations from db/migrations are applied automatically on first
 *   access, so development and tests need zero database setup.
 * - `NODE_ENV=production` + `DATABASE_URL` unset → REFUSED (Session 03.5).
 *   The embedded fallback is per-instance ephemeral storage; silently using
 *   it in production would lose sessions/events/orders on every redeploy.
 *   Production must configure real Postgres or fail loudly at first DB use.
 *
 * One dialect means ONE schema and ONE migration set — no SQLite/Postgres
 * drift. The singleton lives on globalThis to survive Next dev HMR.
 *
 * Server-only: never import from client components.
 */

if (typeof window !== "undefined") {
  throw new Error("db/client is server-only — never import it from client components");
}

/** Common supertype of the node-postgres and PGlite drizzle clients. */
export type Db = PgDatabase<PgQueryResultHKT, Record<string, never>>;

type DbHandle = { db: Db; embedded: boolean };

const MIGRATIONS_FOLDER = path.join(process.cwd(), "db", "migrations");

declare global {
  var __bagdirectDb: Promise<DbHandle> | undefined;
}

async function createDb(): Promise<DbHandle> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url });
    return { db: drizzle(pool) as unknown as Db, embedded: false };
  }

  // Production guard: never silently fall back to the embedded database.
  // PGlite lives on the instance's disk (or in memory) — on a redeploy or
  // second instance every session, event, order and intelligence row would
  // quietly vanish. Failing here is deliberate and must stay.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[db] DATABASE_URL is not set (or empty) while NODE_ENV=production. " +
        "Refusing to fall back to the embedded PGlite database: embedded storage is " +
        "per-instance and disappears on redeploy, so production data (sessions, events, " +
        "orders, quotes, intelligence) would be silently lost. " +
        "Fix: set DATABASE_URL to the production Postgres connection string and apply " +
        "migrations with `npm run db:migrate` BEFORE serving traffic. " +
        "The embedded PGlite fallback remains available for development and tests only.",
    );
  }

  const dataDir = process.env.PGLITE_DATA_DIR || path.join(process.cwd(), ".data", "pglite");
  if (!dataDir.startsWith("memory://")) {
    // PGlite does not create parent directories itself.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dataDir, { recursive: true });
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(dataDir);
  const db = drizzle(client);
  // Embedded databases self-migrate so `next dev` and vitest need no setup.
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Db, embedded: true };
}

/** Lazily initialized shared handle. Concurrent callers await the same init. */
export function getDb(): Promise<Db> {
  if (!globalThis.__bagdirectDb) {
    globalThis.__bagdirectDb = createDb().catch((err) => {
      // Allow a retry on the next call instead of caching the failure forever.
      globalThis.__bagdirectDb = undefined;
      throw err;
    });
  }
  return globalThis.__bagdirectDb.then((h) => h.db);
}

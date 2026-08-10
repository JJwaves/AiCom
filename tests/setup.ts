/**
 * Vitest setup — runs before any test module imports db/client, so the
 * embedded database is an in-memory PGlite (fresh per worker, migrations
 * auto-applied). No filesystem writes, no external Postgres needed.
 */
process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;
delete process.env.QUOTE_WEBHOOK_URL;

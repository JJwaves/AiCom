import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config — `npm run db:generate` (emit SQL migrations from
 * db/schema.ts) and `npm run db:migrate` (apply them).
 *
 * Targets DATABASE_URL when set (real Postgres), otherwise the embedded
 * PGlite dev database. Tests and `next dev` don't need db:migrate at all —
 * embedded databases self-migrate in db/client.ts.
 */

const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  ...(url
    ? { dbCredentials: { url } }
    : { driver: "pglite", dbCredentials: { url: process.env.PGLITE_DATA_DIR ?? "./.data/pglite" } }),
});

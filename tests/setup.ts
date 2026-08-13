/**
 * Vitest setup — runs before any test module imports db/client, so the
 * embedded database is an in-memory PGlite (fresh per worker, migrations
 * auto-applied). No filesystem writes, no external Postgres needed.
 */
process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;
delete process.env.QUOTE_WEBHOOK_URL;

// AI runtime: tests must be deterministic regardless of the developer's
// shell env — no keys, no flags, no real provider calls. Individual tests
// opt in by setting exactly what they need.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("AI_")) delete process.env[key];
}
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

// Admin auth (S08): fail-closed by default in tests too — routes answer 404
// until a test sets both credentials explicitly.
delete process.env.ADMIN_USER;
delete process.env.ADMIN_PASSWORD;

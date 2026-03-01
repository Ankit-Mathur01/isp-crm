// migrations/run.js
// Runs all pending migrations in order

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool, query } = require('../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, 'sql');

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id           SERIAL PRIMARY KEY,
      version      VARCHAR(20)  NOT NULL UNIQUE,
      name         VARCHAR(200) NOT NULL,
      executed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
}

async function getExecuted() {
  const result = await query('SELECT version FROM schema_migrations ORDER BY version');
  return result.rows.map(r => r.version);
}

async function runMigrations() {
  console.log('🗄️  ISP CRM v2 — Running PostgreSQL Migrations\n');
  await ensureMigrationsTable();

  const executed = await getExecuted();
  const files    = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    const version = file.split('_')[0];
    if (executed.includes(version)) {
      console.log(`  ⏭  Skipping ${file} (already applied)`);
      continue;
    }

    console.log(`  ▶  Running  ${file}...`);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [version, file]
      );
      await client.query('COMMIT');
      console.log(`  ✅  Done    ${file}`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ❌  FAILED  ${file}: ${err.message}`);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  console.log(`\n✨  Migrations complete. ${ran} new migration(s) applied.\n`);
  await pool.end();
}

runMigrations().catch(err => {
  console.error('Migration runner error:', err);
  process.exit(1);
});

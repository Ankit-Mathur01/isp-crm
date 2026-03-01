/**
 * rollback.js
 * Drops all CRM tables and types in the correct order.
 * WARNING: This destroys all data. Development use only.
 *
 * Run: node migrations/rollback.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/config/database');
const logger   = require('../src/utils/logger');

async function rollback() {
  logger.warn('⚠️  ROLLBACK: Dropping all CRM database objects...');
  const client = await pool.connect();

  try {
    await client.query(`
      -- Drop views
      DROP VIEW IF EXISTS v_leads_full CASCADE;
      DROP VIEW IF EXISTS v_dashboard_stats CASCADE;

      -- Drop triggers
      DROP TRIGGER IF EXISTS set_leads_updated_at    ON leads;
      DROP TRIGGER IF EXISTS set_users_updated_at    ON users;
      DROP TRIGGER IF EXISTS set_packages_updated_at ON packages;
      DROP TRIGGER IF EXISTS set_invoices_updated_at ON invoices;
      DROP TRIGGER IF EXISTS set_ticket_number       ON leads;
      DROP TRIGGER IF EXISTS set_invoice_number      ON invoices;

      -- Drop functions
      DROP FUNCTION IF EXISTS update_updated_at_column();
      DROP FUNCTION IF EXISTS generate_ticket_number();
      DROP FUNCTION IF EXISTS generate_invoice_number();

      -- Drop sequences
      DROP SEQUENCE IF EXISTS lead_ticket_seq;
      DROP SEQUENCE IF EXISTS invoice_number_seq;

      -- Drop tables (reverse dependency order)
      DROP TABLE IF EXISTS refresh_tokens    CASCADE;
      DROP TABLE IF EXISTS notifications     CASCADE;
      DROP TABLE IF EXISTS audit_logs        CASCADE;
      DROP TABLE IF EXISTS invoices          CASCADE;
      DROP TABLE IF EXISTS lead_documents    CASCADE;
      DROP TABLE IF EXISTS lead_comments     CASCADE;
      DROP TABLE IF EXISTS leads             CASCADE;
      DROP TABLE IF EXISTS areas             CASCADE;
      DROP TABLE IF EXISTS packages          CASCADE;
      DROP TABLE IF EXISTS users             CASCADE;
      DROP TABLE IF EXISTS _migrations       CASCADE;

      -- Drop ENUMs
      DROP TYPE IF EXISTS payment_mode       CASCADE;
      DROP TYPE IF EXISTS payment_status     CASCADE;
      DROP TYPE IF EXISTS installation_status CASCADE;
      DROP TYPE IF EXISTS feasibility_status CASCADE;
      DROP TYPE IF EXISTS lead_type          CASCADE;
      DROP TYPE IF EXISTS lead_source        CASCADE;
      DROP TYPE IF EXISTS lead_priority      CASCADE;
      DROP TYPE IF EXISTS lead_status        CASCADE;
      DROP TYPE IF EXISTS user_status        CASCADE;
      DROP TYPE IF EXISTS user_role          CASCADE;

      -- Drop extensions (optional — comment out if shared DB)
      -- DROP EXTENSION IF EXISTS "uuid-ossp";
      -- DROP EXTENSION IF EXISTS "pg_trgm";
    `);

    logger.info('✅ Rollback complete — all objects dropped');
  } finally {
    client.release();
    await pool.end();
  }
}

rollback().catch((err) => {
  logger.error('❌ Rollback failed', { error: err.message });
  process.exit(1);
});

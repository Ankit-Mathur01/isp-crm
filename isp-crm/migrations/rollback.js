// migrations/rollback.js
// Full v2 rollback — drops all v2 tables safely, preserves v1

require('dotenv').config();
const { pool } = require('../src/config/database');

const ROLLBACK_SQL = `
-- ============================================================
-- ISP CRM v2 ROLLBACK — Drops all v2_ objects only
-- v1 tables (users, leads, packages, activities) are untouched
-- ============================================================

-- Drop triggers first
DROP TRIGGER IF EXISTS trg_leads_status_to_timeline  ON leads;

-- Drop materialized view
DROP MATERIALIZED VIEW IF EXISTS mv_agent_conversion;

-- Drop v2 tables (order matters for FK constraints)
DROP TABLE IF EXISTS v2_webhook_events        CASCADE;
DROP TABLE IF EXISTS v2_commissions           CASCADE;
DROP TABLE IF EXISTS v2_commission_rules      CASCADE;
DROP TABLE IF EXISTS v2_payments              CASCADE;
DROP TABLE IF EXISTS v2_report_snapshots      CASCADE;
DROP TABLE IF EXISTS v2_report_definitions    CASCADE;
DROP TABLE IF EXISTS v2_role_permissions      CASCADE;
DROP TABLE IF EXISTS v2_permissions           CASCADE;
DROP TABLE IF EXISTS v2_custom_field_values   CASCADE;
DROP TABLE IF EXISTS v2_custom_fields         CASCADE;
DROP TABLE IF EXISTS v2_settings              CASCADE;
DROP TABLE IF EXISTS v2_lead_timeline         CASCADE;
DROP TABLE IF EXISTS v2_call_scripts          CASCADE;
DROP TABLE IF EXISTS v2_followups             CASCADE;
DROP TABLE IF EXISTS v2_calls                 CASCADE;
DROP TABLE IF EXISTS v2_feature_flags         CASCADE;

-- Drop v2 functions
DROP FUNCTION IF EXISTS trg_lead_status_timeline() CASCADE;

-- Drop v2 ENUM types
DROP TYPE IF EXISTS call_direction_enum    CASCADE;
DROP TYPE IF EXISTS call_disposition_enum  CASCADE;
DROP TYPE IF EXISTS followup_type_enum     CASCADE;
DROP TYPE IF EXISTS followup_status_enum   CASCADE;
DROP TYPE IF EXISTS timeline_event_enum    CASCADE;
DROP TYPE IF EXISTS field_type_enum        CASCADE;
DROP TYPE IF EXISTS payment_status_enum    CASCADE;
DROP TYPE IF EXISTS payment_method_enum    CASCADE;
DROP TYPE IF EXISTS commission_status_enum CASCADE;

-- Remove v2 migration records (so migrations can be re-run)
DELETE FROM schema_migrations WHERE version >= '002';

SELECT 'v2 rollback complete — v1 tables untouched' AS result;
`;

async function rollback() {
  console.log('⚠️  Rolling back ISP CRM v2...\n');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(ROLLBACK_SQL);
    await client.query('COMMIT');
    console.log('✅ v2 rollback successful\n');
    console.log('   v1 tables preserved: users, leads, packages, activities');
    console.log('   All v2 tables and objects dropped\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Rollback failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

rollback();

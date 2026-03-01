/**
 * migrate.js
 * Runs all DDL migrations in order.
 * Safe to run multiple times — uses IF NOT EXISTS everywhere.
 *
 * Run: node migrations/migrate.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/config/database');
const logger   = require('../src/utils/logger');

// ═════════════════════════════════════════════════════════════════════════════
// SQL MIGRATION STATEMENTS
// ═════════════════════════════════════════════════════════════════════════════

const migrations = [

  // ── 001 — Extensions ──────────────────────────────────────────────────────
  {
    name: '001_extensions',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for ILIKE trigram indexes
    `,
  },

  // ── 002 — ENUM types ──────────────────────────────────────────────────────
  {
    name: '002_enums',
    sql: `
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM (
          'admin', 'sales', 'it', 'installation', 'accounts'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE lead_status AS ENUM (
          'new',
          'feasibility_pending',
          'not_feasible',
          'infrastructure_required',
          'installation_pending',
          'installation_in_progress',
          'installation_failed',
          'payment_pending',
          'payment_partial',
          'activated',
          'closed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE lead_priority AS ENUM ('hot', 'warm', 'cold');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE lead_source AS ENUM (
          'call', 'website', 'walkin', 'referral',
          'advertisement', 'social_media', 'field_visit'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE lead_type AS ENUM (
          'residential', 'commercial', 'enterprise', 'government', 'educational'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE feasibility_status AS ENUM (
          'pending', 'feasible', 'not_feasible', 'infrastructure_required'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE installation_status AS ENUM (
          'pending', 'in_progress', 'installed', 'failed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM (
          'pending', 'partial', 'completed', 'refunded'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE payment_mode AS ENUM (
          'upi', 'cash', 'bank_transfer', 'neft_rtgs',
          'cheque', 'credit_card', 'demand_draft'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `,
  },

  // ── 003 — users ──────────────────────────────────────────────────────────
  {
    name: '003_users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        employee_id   VARCHAR(20)   UNIQUE NOT NULL,
        name          VARCHAR(100)  NOT NULL,
        email         VARCHAR(150)  UNIQUE NOT NULL,
        password_hash VARCHAR(255)  NOT NULL,
        role          user_role     NOT NULL DEFAULT 'sales',
        status        user_status   NOT NULL DEFAULT 'active',
        phone         VARCHAR(15),
        avatar_url    VARCHAR(500),
        last_login_at TIMESTAMPTZ,
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_email  ON users (email);
      CREATE INDEX IF NOT EXISTS idx_users_role   ON users (role);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

      COMMENT ON TABLE  users IS 'CRM user accounts with role-based access control';
      COMMENT ON COLUMN users.employee_id IS 'Unique human-readable employee code e.g. EMP-001';
    `,
  },

  // ── 004 — packages (master data) ─────────────────────────────────────────
  {
    name: '004_packages',
    sql: `
      CREATE TABLE IF NOT EXISTS packages (
        id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        name           VARCHAR(100)  NOT NULL UNIQUE,
        speed_mbps     INTEGER       NOT NULL,
        monthly_price  NUMERIC(10,2) NOT NULL,
        setup_fee      NUMERIC(10,2) NOT NULL DEFAULT 0,
        description    TEXT,
        is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
        created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_packages_active ON packages (is_active);
    `,
  },

  // ── 005 — areas (master data) ────────────────────────────────────────────
  {
    name: '005_areas',
    sql: `
      CREATE TABLE IF NOT EXISTS areas (
        id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        name         VARCHAR(100) NOT NULL UNIQUE,
        city         VARCHAR(100),
        state        VARCHAR(100),
        pincode      VARCHAR(10),
        is_serviceable BOOLEAN    NOT NULL DEFAULT TRUE,
        notes        TEXT,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_areas_serviceable ON areas (is_serviceable);
    `,
  },

  // ── 006 — leads (core table) ─────────────────────────────────────────────
  {
    name: '006_leads',
    sql: `
      CREATE TABLE IF NOT EXISTS leads (
        -- Identity
        id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        ticket_number   VARCHAR(20)   UNIQUE NOT NULL,  -- e.g. LD-0001

        -- Basic info
        lead_source     lead_source   NOT NULL,
        lead_type       lead_type     NOT NULL,
        priority        lead_priority NOT NULL DEFAULT 'warm',

        -- Customer
        customer_name   VARCHAR(150)  NOT NULL,
        mobile          VARCHAR(15)   NOT NULL,
        alt_mobile      VARCHAR(15),
        email           VARCHAR(150),

        -- Address
        address         TEXT          NOT NULL,
        area_id         UUID          REFERENCES areas(id) ON DELETE SET NULL,
        pincode         VARCHAR(10),
        landmark        VARCHAR(200),
        gps_lat         NUMERIC(10,7),
        gps_lng         NUMERIC(10,7),

        -- Package
        package_id      UUID          REFERENCES packages(id) ON DELETE SET NULL,

        -- Ownership
        assigned_to     UUID          REFERENCES users(id) ON DELETE SET NULL,   -- salesperson

        -- Workflow status
        status          lead_status   NOT NULL DEFAULT 'new',

        -- Feasibility
        feasibility_status   feasibility_status NOT NULL DEFAULT 'pending',
        feasibility_notes    TEXT,
        feasibility_by       UUID               REFERENCES users(id) ON DELETE SET NULL,
        feasibility_at       TIMESTAMPTZ,

        -- Installation
        installation_status  installation_status NOT NULL DEFAULT 'pending',
        installation_notes   TEXT,
        installation_by      UUID                REFERENCES users(id) ON DELETE SET NULL,
        installation_date    DATE,
        equipment_details    JSONB               DEFAULT '{}',

        -- Payment
        payment_status    payment_status NOT NULL DEFAULT 'pending',
        payment_mode      payment_mode,
        transaction_id    VARCHAR(100),
        amount_due        NUMERIC(10,2),
        amount_paid       NUMERIC(10,2)  DEFAULT 0,
        payment_verified_by UUID          REFERENCES users(id) ON DELETE SET NULL,
        payment_verified_at TIMESTAMPTZ,

        -- Activation
        activated_at      TIMESTAMPTZ,
        activated_by      UUID          REFERENCES users(id) ON DELETE SET NULL,

        -- Notes
        internal_notes    TEXT,

        -- Metadata
        created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        closed_at         TIMESTAMPTZ,
        closed_reason     TEXT
      );

      -- Performance indexes
      CREATE INDEX IF NOT EXISTS idx_leads_ticket_number     ON leads (ticket_number);
      CREATE INDEX IF NOT EXISTS idx_leads_status            ON leads (status);
      CREATE INDEX IF NOT EXISTS idx_leads_priority          ON leads (priority);
      CREATE INDEX IF NOT EXISTS idx_leads_assigned_to       ON leads (assigned_to);
      CREATE INDEX IF NOT EXISTS idx_leads_area_id           ON leads (area_id);
      CREATE INDEX IF NOT EXISTS idx_leads_package_id        ON leads (package_id);
      CREATE INDEX IF NOT EXISTS idx_leads_mobile            ON leads (mobile);
      CREATE INDEX IF NOT EXISTS idx_leads_created_at        ON leads (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_leads_feasibility_status ON leads (feasibility_status);
      CREATE INDEX IF NOT EXISTS idx_leads_payment_status    ON leads (payment_status);

      -- Full-text search on customer name and address
      CREATE INDEX IF NOT EXISTS idx_leads_customer_trgm ON leads USING gin (customer_name gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_leads_address_trgm  ON leads USING gin (address gin_trgm_ops);

      COMMENT ON TABLE  leads IS 'Core leads table — tracks full broadband sales lifecycle';
      COMMENT ON COLUMN leads.ticket_number IS 'Human-readable ID shown in UI (e.g. LD-0001)';
      COMMENT ON COLUMN leads.equipment_details IS 'JSON: ONT model, router model, cable length, etc.';
    `,
  },

  // ── 007 — lead_comments ───────────────────────────────────────────────────
  {
    name: '007_lead_comments',
    sql: `
      CREATE TABLE IF NOT EXISTS lead_comments (
        id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        lead_id    UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
        comment    TEXT        NOT NULL,
        is_internal BOOLEAN    NOT NULL DEFAULT TRUE,  -- FALSE = visible to customer portal
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_lead_comments_lead_id    ON lead_comments (lead_id);
      CREATE INDEX IF NOT EXISTS idx_lead_comments_created_at ON lead_comments (created_at DESC);
    `,
  },

  // ── 008 — lead_documents ─────────────────────────────────────────────────
  {
    name: '008_lead_documents',
    sql: `
      CREATE TABLE IF NOT EXISTS lead_documents (
        id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        lead_id       UUID         NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        uploaded_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
        file_name     VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_path     VARCHAR(500) NOT NULL,
        file_size     INTEGER,               -- bytes
        mime_type     VARCHAR(100),
        doc_type      VARCHAR(50),           -- 'id_proof', 'address_proof', 'installation_photo', etc.
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_lead_docs_lead_id ON lead_documents (lead_id);
    `,
  },

  // ── 009 — invoices ────────────────────────────────────────────────────────
  {
    name: '009_invoices',
    sql: `
      CREATE TABLE IF NOT EXISTS invoices (
        id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        invoice_number VARCHAR(30)   UNIQUE NOT NULL,   -- INV-0001
        lead_id        UUID          NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        amount         NUMERIC(10,2) NOT NULL,
        tax_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
        discount       NUMERIC(10,2) NOT NULL DEFAULT 0,
        total_amount   NUMERIC(10,2) NOT NULL,
        payment_mode   payment_mode,
        transaction_id VARCHAR(100),
        payment_status payment_status NOT NULL DEFAULT 'pending',
        paid_at        TIMESTAMPTZ,
        notes          TEXT,
        generated_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
        created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_invoices_lead_id        ON invoices (lead_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices (payment_status);
      CREATE INDEX IF NOT EXISTS idx_invoices_created_at     ON invoices (created_at DESC);
    `,
  },

  // ── 010 — audit_logs ─────────────────────────────────────────────────────
  {
    name: '010_audit_logs',
    sql: `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id      UUID         REFERENCES users(id) ON DELETE SET NULL,
        user_role    user_role,
        action       VARCHAR(100) NOT NULL,
        entity_type  VARCHAR(50)  NOT NULL,    -- 'lead', 'user', 'invoice', etc.
        entity_id    UUID,
        old_values   JSONB        DEFAULT '{}',
        new_values   JSONB        DEFAULT '{}',
        ip_address   INET,
        user_agent   TEXT,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_audit_user_id     ON audit_logs (user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_entity      ON audit_logs (entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created_at  ON audit_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_action      ON audit_logs (action);
    `,
  },

  // ── 011 — notifications ───────────────────────────────────────────────────
  {
    name: '011_notifications',
    sql: `
      CREATE TABLE IF NOT EXISTS notifications (
        id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      VARCHAR(200) NOT NULL,
        message    TEXT        NOT NULL,
        type       VARCHAR(30) NOT NULL DEFAULT 'info',  -- info | warning | error | success
        entity_type VARCHAR(50),
        entity_id   UUID,
        is_read    BOOLEAN     NOT NULL DEFAULT FALSE,
        read_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_notif_user_id    ON notifications (user_id);
      CREATE INDEX IF NOT EXISTS idx_notif_is_read    ON notifications (user_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_notif_created_at ON notifications (created_at DESC);
    `,
  },

  // ── 012 — refresh_tokens ──────────────────────────────────────────────────
  {
    name: '012_refresh_tokens',
    sql: `
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_rt_user_id ON refresh_tokens (user_id);
      CREATE INDEX IF NOT EXISTS idx_rt_expires  ON refresh_tokens (expires_at);
    `,
  },

  // ── 013 — Triggers: updated_at auto-update ────────────────────────────────
  {
    name: '013_triggers',
    sql: `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS set_users_updated_at    ON users;
      CREATE TRIGGER set_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS set_leads_updated_at    ON leads;
      CREATE TRIGGER set_leads_updated_at
        BEFORE UPDATE ON leads
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS set_packages_updated_at ON packages;
      CREATE TRIGGER set_packages_updated_at
        BEFORE UPDATE ON packages
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS set_invoices_updated_at ON invoices;
      CREATE TRIGGER set_invoices_updated_at
        BEFORE UPDATE ON invoices
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `,
  },

  // ── 014 — auto ticket_number sequence ────────────────────────────────────
  {
    name: '014_ticket_sequence',
    sql: `
      CREATE SEQUENCE IF NOT EXISTS lead_ticket_seq START 1;

      CREATE OR REPLACE FUNCTION generate_ticket_number()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
          NEW.ticket_number := 'LD-' || LPAD(nextval('lead_ticket_seq')::TEXT, 4, '0');
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS set_ticket_number ON leads;
      CREATE TRIGGER set_ticket_number
        BEFORE INSERT ON leads
        FOR EACH ROW EXECUTE FUNCTION generate_ticket_number();

      -- Invoice number sequence
      CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

      CREATE OR REPLACE FUNCTION generate_invoice_number()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
          NEW.invoice_number := 'INV-' || LPAD(nextval('invoice_number_seq')::TEXT, 4, '0');
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS set_invoice_number ON invoices;
      CREATE TRIGGER set_invoice_number
        BEFORE INSERT ON invoices
        FOR EACH ROW EXECUTE FUNCTION generate_invoice_number();
    `,
  },

  // ── 015 — Views ───────────────────────────────────────────────────────────
  {
    name: '015_views',
    sql: `
      -- Full lead view joining all relations
      CREATE OR REPLACE VIEW v_leads_full AS
      SELECT
        l.*,
        a.name          AS area_name,
        a.city          AS area_city,
        a.pincode       AS area_pincode,
        p.name          AS package_name,
        p.speed_mbps    AS package_speed,
        p.monthly_price AS package_price,
        u_sales.name    AS salesperson_name,
        u_sales.email   AS salesperson_email,
        u_feas.name     AS feasibility_by_name,
        u_inst.name     AS installation_by_name,
        u_pay.name      AS payment_verified_by_name,
        u_act.name      AS activated_by_name
      FROM leads l
      LEFT JOIN areas    a      ON l.area_id            = a.id
      LEFT JOIN packages p      ON l.package_id         = p.id
      LEFT JOIN users u_sales   ON l.assigned_to        = u_sales.id
      LEFT JOIN users u_feas    ON l.feasibility_by     = u_feas.id
      LEFT JOIN users u_inst    ON l.installation_by    = u_inst.id
      LEFT JOIN users u_pay     ON l.payment_verified_by= u_pay.id
      LEFT JOIN users u_act     ON l.activated_by       = u_act.id;

      -- Dashboard summary view
      CREATE OR REPLACE VIEW v_dashboard_stats AS
      SELECT
        COUNT(*)                                                          AS total_leads,
        COUNT(*) FILTER (WHERE status = 'new')                           AS new_leads,
        COUNT(*) FILTER (WHERE status IN ('new','feasibility_pending'))  AS feasibility_queue,
        COUNT(*) FILTER (WHERE status IN ('installation_pending','installation_in_progress')) AS installation_queue,
        COUNT(*) FILTER (WHERE status IN ('payment_pending','payment_partial')) AS payment_queue,
        COUNT(*) FILTER (WHERE status = 'activated')                     AS activated,
        COUNT(*) FILTER (WHERE status IN ('not_feasible','closed','installation_failed')) AS closed_lost,
        SUM(amount_due) FILTER (WHERE status = 'activated')              AS total_revenue,
        SUM(amount_due) FILTER (WHERE status IN ('payment_pending','payment_partial')) AS pending_revenue
      FROM leads;
    `,
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// Run migrations
// ═════════════════════════════════════════════════════════════════════════════

async function runMigrations() {
  logger.info('🚀 Starting database migrations...');
  const client = await pool.connect();

  try {
    // Create tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL      PRIMARY KEY,
        name       VARCHAR(200) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const migration of migrations) {
      const { rows } = await client.query(
        'SELECT id FROM _migrations WHERE name = $1',
        [migration.name]
      );

      if (rows.length > 0) {
        logger.info(`  ⏭  Skipping  ${migration.name} (already applied)`);
        continue;
      }

      logger.info(`  ▶  Applying  ${migration.name}...`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [migration.name]);
        await client.query('COMMIT');
        logger.info(`  ✅  Applied   ${migration.name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.name} failed: ${err.message}`);
      }
    }

    logger.info('✅ All migrations applied successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  logger.error('❌ Migration failed', { error: err.message });
  process.exit(1);
});

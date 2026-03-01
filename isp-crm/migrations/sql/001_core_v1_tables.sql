-- ============================================================
-- Migration 001: Core v1 Tables (ISP CRM - Preserved as-is)
-- These are the ORIGINAL v1 tables. We never modify them.
-- All v2 additions are in separate migrations.
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy search
CREATE EXTENSION IF NOT EXISTS "btree_gin";   -- composite indexes

-- ─────────────────────────────────────────
-- ENUM types
-- ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role_enum     AS ENUM ('super_admin', 'admin', 'manager', 'agent');
  CREATE TYPE lead_status_enum   AS ENUM ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost');
  CREATE TYPE lead_source_enum   AS ENUM ('website', 'referral', 'cold_call', 'social', 'email', 'event', 'other');
  CREATE TYPE priority_enum      AS ENUM ('low', 'medium', 'high', 'urgent');
  CREATE TYPE package_status_enum AS ENUM ('active', 'inactive', 'discontinued');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────
-- users (v1 - DO NOT MODIFY)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  phone         VARCHAR(30),
  role          user_role_enum NOT NULL DEFAULT 'agent',
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active   ON users(is_active);

-- ─────────────────────────────────────────
-- packages (v1 - DO NOT MODIFY)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS packages (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(150)  NOT NULL,
  description   TEXT,
  speed_mbps    INTEGER       NOT NULL,
  price_monthly NUMERIC(10,2) NOT NULL,
  status        package_status_enum NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- leads (v1 - DO NOT MODIFY)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id              UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name       VARCHAR(150)     NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(30)      NOT NULL,
  address         TEXT,
  city            VARCHAR(100),
  status          lead_status_enum NOT NULL DEFAULT 'new',
  source          lead_source_enum NOT NULL DEFAULT 'other',
  priority        priority_enum    NOT NULL DEFAULT 'medium',
  assigned_to     UUID             REFERENCES users(id) ON DELETE SET NULL,
  package_id      UUID             REFERENCES packages(id) ON DELETE SET NULL,
  notes           TEXT,
  score           INTEGER          DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  expected_value  NUMERIC(10,2),
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_created_at  ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_phone       ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_search      ON leads USING gin(
  to_tsvector('english', coalesce(full_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,''))
);

-- ─────────────────────────────────────────
-- activities (v1 - DO NOT MODIFY)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  type        VARCHAR(50) NOT NULL,  -- call, email, meeting, note
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_lead_id ON activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id);

-- ─────────────────────────────────────────
-- Auto-update updated_at trigger (reusable)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_users_updated_at    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  CREATE TRIGGER trg_leads_updated_at    BEFORE UPDATE ON leads    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  CREATE TRIGGER trg_packages_updated_at BEFORE UPDATE ON packages FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

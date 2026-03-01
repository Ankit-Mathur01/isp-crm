-- ============================================================
-- Migration 004: Module 04 (Permissions) + 05 (Reports) + 06 (Payments)
-- ============================================================

-- ─────────────────────────────────────────
-- Module 04: Role Permissions
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_permissions (
  id          SERIAL       PRIMARY KEY,
  module      VARCHAR(60)  NOT NULL,
  action      VARCHAR(60)  NOT NULL,   -- create, read, update, delete, export
  description TEXT,
  UNIQUE(module, action)
);

-- Seed default permissions
INSERT INTO v2_permissions (module, action, description) VALUES
  ('leads',      'create',  'Create new leads'),
  ('leads',      'read',    'View lead details'),
  ('leads',      'update',  'Edit lead information'),
  ('leads',      'delete',  'Delete leads'),
  ('leads',      'export',  'Export leads to CSV/Excel'),
  ('leads',      'assign',  'Assign leads to agents'),
  ('calls',      'create',  'Log calls'),
  ('calls',      'read',    'View call logs'),
  ('followups',  'create',  'Schedule follow-ups'),
  ('followups',  'read',    'View follow-ups'),
  ('followups',  'update',  'Update follow-up status'),
  ('reports',    'read',    'View reports'),
  ('reports',    'export',  'Export report data'),
  ('settings',   'read',    'View settings'),
  ('settings',   'update',  'Modify settings'),
  ('payments',   'read',    'View payment records'),
  ('payments',   'create',  'Create payment records'),
  ('users',      'read',    'View user list'),
  ('users',      'create',  'Add new users'),
  ('users',      'update',  'Edit user details'),
  ('users',      'delete',  'Deactivate users')
ON CONFLICT (module, action) DO NOTHING;

CREATE TABLE IF NOT EXISTS v2_role_permissions (
  id            SERIAL     PRIMARY KEY,
  role          user_role_enum NOT NULL,
  permission_id INTEGER    NOT NULL REFERENCES v2_permissions(id) ON DELETE CASCADE,
  granted       BOOLEAN    NOT NULL DEFAULT true,
  UNIQUE(role, permission_id)
);

-- Default role grants: super_admin gets all, admin gets most, manager limited, agent minimal
INSERT INTO v2_role_permissions (role, permission_id, granted)
SELECT 'super_admin', id, true FROM v2_permissions
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO v2_role_permissions (role, permission_id, granted)
SELECT 'admin', id, true FROM v2_permissions WHERE action != 'delete'
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO v2_role_permissions (role, permission_id, granted)
SELECT 'manager', id, true FROM v2_permissions 
WHERE (module = 'leads' AND action IN ('create','read','update','assign'))
   OR (module = 'calls')
   OR (module = 'followups')
   OR (module = 'reports' AND action = 'read')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO v2_role_permissions (role, permission_id, granted)
SELECT 'agent', id, true FROM v2_permissions 
WHERE (module = 'leads' AND action IN ('read','update'))
   OR (module = 'calls' AND action IN ('create','read'))
   OR (module = 'followups')
ON CONFLICT (role, permission_id) DO NOTHING;

-- ─────────────────────────────────────────
-- Module 05: Reporting
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_report_definitions (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(150) NOT NULL,
  description  TEXT,
  query_config JSONB        NOT NULL DEFAULT '{}'::JSONB,
  chart_type   VARCHAR(30),  -- bar, line, pie, table
  is_system    BOOLEAN      NOT NULL DEFAULT false,
  is_shared    BOOLEAN      NOT NULL DEFAULT false,
  created_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2_report_snapshots (
  id          BIGSERIAL    PRIMARY KEY,
  report_id   UUID         NOT NULL REFERENCES v2_report_definitions(id) ON DELETE CASCADE,
  data        JSONB        NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by UUID        REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_snapshots_report_id ON v2_report_snapshots(report_id);

-- Materialized view: lead conversion by agent (refreshed by cron)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_agent_conversion AS
SELECT
  u.id                                            AS agent_id,
  u.full_name                                     AS agent_name,
  COUNT(l.id)                                     AS total_leads,
  COUNT(l.id) FILTER (WHERE l.status = 'won')     AS won_leads,
  COUNT(l.id) FILTER (WHERE l.status = 'lost')    AS lost_leads,
  ROUND(
    COUNT(l.id) FILTER (WHERE l.status = 'won')::NUMERIC
    / NULLIF(COUNT(l.id), 0) * 100, 2
  )                                               AS conversion_rate,
  SUM(l.expected_value) FILTER (WHERE l.status = 'won') AS total_revenue,
  DATE_TRUNC('month', NOW())                      AS period
FROM users u
LEFT JOIN leads l ON l.assigned_to = u.id
WHERE u.is_active = true
GROUP BY u.id, u.full_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_agent_conv ON mv_agent_conversion(agent_id);

-- ─────────────────────────────────────────
-- Module 06: Payments
-- ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE payment_status_enum AS ENUM ('pending', 'completed', 'failed', 'refunded', 'disputed');
  CREATE TYPE payment_method_enum AS ENUM ('stripe', 'bank_transfer', 'cash', 'cheque', 'other');
  CREATE TYPE commission_status_enum AS ENUM ('pending', 'approved', 'paid', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS v2_payments (
  id               UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id          UUID                 NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  package_id       UUID                 REFERENCES packages(id) ON DELETE SET NULL,
  amount           NUMERIC(12,2)        NOT NULL CHECK (amount > 0),
  currency         CHAR(3)              NOT NULL DEFAULT 'USD',
  status           payment_status_enum  NOT NULL DEFAULT 'pending',
  method           payment_method_enum  NOT NULL DEFAULT 'stripe',
  stripe_payment_id VARCHAR(200),
  stripe_invoice_id VARCHAR(200),
  notes            TEXT,
  paid_at          TIMESTAMPTZ,
  created_by       UUID                 REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_payments_lead_id   ON v2_payments(lead_id);
CREATE INDEX IF NOT EXISTS idx_v2_payments_status    ON v2_payments(status);
CREATE INDEX IF NOT EXISTS idx_v2_payments_paid_at   ON v2_payments(paid_at);
CREATE INDEX IF NOT EXISTS idx_v2_payments_stripe_id ON v2_payments(stripe_payment_id);

CREATE TABLE IF NOT EXISTS v2_commission_rules (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(150)  NOT NULL,
  applies_to_role user_role_enum,
  rate_type       VARCHAR(20)   NOT NULL DEFAULT 'percentage',  -- percentage | fixed
  rate            NUMERIC(8,4)  NOT NULL,
  min_payment     NUMERIC(10,2) DEFAULT 0,
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2_commissions (
  id             UUID                   PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id     UUID                   NOT NULL REFERENCES v2_payments(id) ON DELETE RESTRICT,
  agent_id       UUID                   NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rule_id        UUID                   REFERENCES v2_commission_rules(id),
  base_amount    NUMERIC(12,2)          NOT NULL,
  rate           NUMERIC(8,4)           NOT NULL,
  commission_amt NUMERIC(12,2)          NOT NULL,
  status         commission_status_enum NOT NULL DEFAULT 'pending',
  approved_by    UUID                   REFERENCES users(id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_commissions_agent_id   ON v2_commissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_v2_commissions_payment_id ON v2_commissions(payment_id);
CREATE INDEX IF NOT EXISTS idx_v2_commissions_status     ON v2_commissions(status);

-- Webhook events log (idempotency)
CREATE TABLE IF NOT EXISTS v2_webhook_events (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider     VARCHAR(30) NOT NULL DEFAULT 'stripe',
  event_type   VARCHAR(100) NOT NULL,
  external_id  VARCHAR(200) NOT NULL UNIQUE,  -- stripe event id
  payload      JSONB        NOT NULL,
  processed    BOOLEAN      NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_webhook_external_id ON v2_webhook_events(external_id);
CREATE INDEX IF NOT EXISTS idx_v2_webhook_processed   ON v2_webhook_events(processed);

-- Triggers
DO $$ BEGIN
  CREATE TRIGGER trg_v2_payments_updated_at    BEFORE UPDATE ON v2_payments    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  CREATE TRIGGER trg_v2_commissions_updated_at BEFORE UPDATE ON v2_commissions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

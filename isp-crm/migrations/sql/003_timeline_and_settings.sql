-- ============================================================
-- Migration 003: Module 02 (Lead Timeline) + Module 03 (Master Settings)
-- ============================================================

-- ─────────────────────────────────────────
-- ENUM: timeline event types
-- ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE timeline_event_enum AS ENUM (
    'created', 'status_changed', 'assigned', 'call_made', 'call_received',
    'followup_scheduled', 'followup_completed', 'note_added', 'email_sent',
    'proposal_sent', 'payment_received', 'file_uploaded', 'custom'
  );
  CREATE TYPE field_type_enum AS ENUM ('text', 'number', 'date', 'select', 'multiselect', 'boolean', 'textarea');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────
-- v2_lead_timeline
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_lead_timeline (
  id           UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id      UUID                NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id      UUID                REFERENCES users(id) ON DELETE SET NULL,
  event_type   timeline_event_enum NOT NULL,
  title        VARCHAR(200)        NOT NULL,
  description  TEXT,
  metadata     JSONB               DEFAULT '{}'::JSONB,
  is_system    BOOLEAN             NOT NULL DEFAULT false,   -- auto-generated vs manual
  occurred_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_timeline_lead_id     ON v2_lead_timeline(lead_id);
CREATE INDEX IF NOT EXISTS idx_v2_timeline_occurred_at ON v2_lead_timeline(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_timeline_event_type  ON v2_lead_timeline(event_type);
CREATE INDEX IF NOT EXISTS idx_v2_timeline_metadata    ON v2_lead_timeline USING gin(metadata);

-- ─────────────────────────────────────────
-- Auto-insert timeline row when lead status changes (trigger)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_lead_status_timeline()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO v2_lead_timeline (lead_id, event_type, title, is_system, metadata)
    VALUES (
      NEW.id,
      'status_changed',
      'Status changed: ' || OLD.status || ' → ' || NEW.status,
      true,
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_leads_status_to_timeline
    AFTER UPDATE ON leads
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION trg_lead_status_timeline();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────
-- v2_settings (global CRM settings)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_settings (
  id          SERIAL       PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  value       TEXT,
  data_type   VARCHAR(30)  NOT NULL DEFAULT 'string',  -- string, number, boolean, json
  category    VARCHAR(60)  NOT NULL DEFAULT 'general',
  description TEXT,
  updated_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO v2_settings (setting_key, value, data_type, category, description) VALUES
  ('company_name',           'My ISP Company',  'string',  'general',  'Company display name'),
  ('default_followup_hours', '24',              'number',  'followup', 'Hours before auto-reminder'),
  ('lead_score_threshold',   '70',              'number',  'scoring',  'Minimum score for hot lead'),
  ('max_leads_per_agent',    '50',              'number',  'general',  'Max concurrent leads per agent'),
  ('currency_code',          'USD',             'string',  'payments', 'ISO currency code'),
  ('timezone',               'UTC',             'string',  'general',  'Default system timezone'),
  ('email_notifications',    'true',            'boolean', 'notifications', 'Enable email notifications')
ON CONFLICT (setting_key) DO NOTHING;

-- ─────────────────────────────────────────
-- v2_custom_fields
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_custom_fields (
  id           UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type  VARCHAR(30)     NOT NULL,  -- lead, user, package
  field_key    VARCHAR(80)     NOT NULL,
  label        VARCHAR(150)    NOT NULL,
  field_type   field_type_enum NOT NULL DEFAULT 'text',
  options      JSONB,           -- for select/multiselect: ["Option A", "Option B"]
  is_required  BOOLEAN         NOT NULL DEFAULT false,
  is_visible   BOOLEAN         NOT NULL DEFAULT true,
  sort_order   INTEGER         NOT NULL DEFAULT 0,
  created_by   UUID            REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE(entity_type, field_key)
);

-- v2_custom_field_values (EAV store for lead custom data)
CREATE TABLE IF NOT EXISTS v2_custom_field_values (
  id         BIGSERIAL   PRIMARY KEY,
  entity_id  UUID        NOT NULL,
  field_id   UUID        NOT NULL REFERENCES v2_custom_fields(id) ON DELETE CASCADE,
  value_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_cfv_entity_id ON v2_custom_field_values(entity_id);
CREATE INDEX IF NOT EXISTS idx_v2_cfv_field_id  ON v2_custom_field_values(field_id);

DO $$ BEGIN
  CREATE TRIGGER trg_v2_custom_fields_updated_at BEFORE UPDATE ON v2_custom_fields       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  CREATE TRIGGER trg_v2_cfv_updated_at           BEFORE UPDATE ON v2_custom_field_values FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

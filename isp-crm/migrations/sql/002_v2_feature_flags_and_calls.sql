-- ============================================================
-- Migration 002: v2 Feature Flags + Module 01 (Call & Follow-Up)
-- ============================================================

-- ─────────────────────────────────────────
-- v2_feature_flags (controls all v2 modules)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_feature_flags (
  id          SERIAL       PRIMARY KEY,
  flag_key    VARCHAR(60)  NOT NULL UNIQUE,
  is_enabled  BOOLEAN      NOT NULL DEFAULT false,
  description TEXT,
  updated_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO v2_feature_flags (flag_key, description) VALUES
  ('call_followup',    'Module 01: Call logging and follow-up scheduling'),
  ('lead_timeline',    'Module 02: Lead lifecycle timeline and events'),
  ('master_settings',  'Module 03: Global settings and custom fields'),
  ('role_permissions', 'Module 04: Granular role-based permissions'),
  ('reporting',        'Module 05: Advanced reports and analytics'),
  ('payments',         'Module 06: Payment processing and commission tracking')
ON CONFLICT (flag_key) DO NOTHING;

-- ─────────────────────────────────────────
-- ENUM: call types & dispositions
-- ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE call_direction_enum    AS ENUM ('inbound', 'outbound');
  CREATE TYPE call_disposition_enum  AS ENUM ('answered', 'no_answer', 'busy', 'voicemail', 'wrong_number', 'callback_requested');
  CREATE TYPE followup_type_enum     AS ENUM ('call', 'email', 'sms', 'meeting', 'demo', 'site_visit');
  CREATE TYPE followup_status_enum   AS ENUM ('pending', 'completed', 'missed', 'rescheduled', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────
-- v2_calls
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_calls (
  id              UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id         UUID                 NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id         UUID                 NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  direction       call_direction_enum  NOT NULL DEFAULT 'outbound',
  disposition     call_disposition_enum NOT NULL DEFAULT 'answered',
  duration_secs   INTEGER              DEFAULT 0,
  notes           TEXT,
  recording_url   VARCHAR(500),
  called_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_calls_lead_id   ON v2_calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_v2_calls_user_id   ON v2_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_v2_calls_called_at ON v2_calls(called_at);

-- ─────────────────────────────────────────
-- v2_followups
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_followups (
  id              UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id         UUID                  NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to     UUID                  NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by      UUID                  NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  type            followup_type_enum    NOT NULL DEFAULT 'call',
  status          followup_status_enum  NOT NULL DEFAULT 'pending',
  scheduled_at    TIMESTAMPTZ           NOT NULL,
  completed_at    TIMESTAMPTZ,
  notes           TEXT,
  reminder_sent   BOOLEAN               NOT NULL DEFAULT false,
  priority        priority_enum         NOT NULL DEFAULT 'medium',
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_followups_lead_id      ON v2_followups(lead_id);
CREATE INDEX IF NOT EXISTS idx_v2_followups_assigned_to  ON v2_followups(assigned_to);
CREATE INDEX IF NOT EXISTS idx_v2_followups_scheduled_at ON v2_followups(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_v2_followups_status       ON v2_followups(status);

-- ─────────────────────────────────────────
-- v2_call_scripts
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v2_call_scripts (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(150) NOT NULL,
  description TEXT,
  content     TEXT         NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Triggers
DO $$ BEGIN
  CREATE TRIGGER trg_v2_followups_updated_at    BEFORE UPDATE ON v2_followups    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  CREATE TRIGGER trg_v2_call_scripts_updated_at BEFORE UPDATE ON v2_call_scripts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

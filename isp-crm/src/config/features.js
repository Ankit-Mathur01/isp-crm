// src/config/features.js
// v2 Feature flag management - zero-risk module activation

const { query } = require('./database');

// In-memory cache for fast flag lookups
let flagCache = {};
let cacheExpiry = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Load flags from DB (with env override fallback)
 */
const loadFlags = async () => {
  try {
    const result = await query(
      'SELECT flag_key, is_enabled, metadata FROM v2_feature_flags'
    );
    const now = Date.now();
    flagCache = {};
    result.rows.forEach(row => {
      flagCache[row.flag_key] = {
        enabled:  row.is_enabled,
        metadata: row.metadata,
        loadedAt: now,
      };
    });
    cacheExpiry = now + CACHE_TTL;
  } catch (err) {
    // Fallback to environment variables if DB not ready yet
    flagCache = {
      call_followup:    { enabled: process.env.FEATURE_CALL_FOLLOWUP    === 'true' },
      lead_timeline:    { enabled: process.env.FEATURE_LEAD_TIMELINE    === 'true' },
      master_settings:  { enabled: process.env.FEATURE_MASTER_SETTINGS  === 'true' },
      role_permissions: { enabled: process.env.FEATURE_ROLE_PERMISSIONS === 'true' },
      reporting:        { enabled: process.env.FEATURE_REPORTING        === 'true' },
      payments:         { enabled: process.env.FEATURE_PAYMENTS         === 'true' },
    };
    cacheExpiry = Date.now() + CACHE_TTL;
  }
};

/**
 * Check if a feature flag is enabled
 */
const isEnabled = async (flagKey) => {
  if (Date.now() > cacheExpiry) await loadFlags();
  return flagCache[flagKey]?.enabled === true;
};

/**
 * Get all flags (for admin dashboard)
 */
const getAllFlags = async () => {
  if (Date.now() > cacheExpiry) await loadFlags();
  return flagCache;
};

/**
 * Update a flag in the database
 */
const setFlag = async (flagKey, enabled, updatedBy) => {
  await query(
    `UPDATE v2_feature_flags 
     SET is_enabled = $1, updated_by = $2, updated_at = NOW()
     WHERE flag_key = $3`,
    [enabled, updatedBy, flagKey]
  );
  // Bust cache
  cacheExpiry = 0;
};

/**
 * Middleware: block route if feature is disabled
 */
const requireFeature = (flagKey) => async (req, res, next) => {
  const enabled = await isEnabled(flagKey);
  if (!enabled) {
    return res.status(503).json({
      success: false,
      error: 'Feature not available',
      code: 'FEATURE_DISABLED',
      feature: flagKey,
    });
  }
  next();
};

// Pre-defined flag keys
const FLAGS = {
  CALL_FOLLOWUP:    'call_followup',
  LEAD_TIMELINE:    'lead_timeline',
  MASTER_SETTINGS:  'master_settings',
  ROLE_PERMISSIONS: 'role_permissions',
  REPORTING:        'reporting',
  PAYMENTS:         'payments',
};

module.exports = { loadFlags, isEnabled, getAllFlags, setFlag, requireFeature, FLAGS };

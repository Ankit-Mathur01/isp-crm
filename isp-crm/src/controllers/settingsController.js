// src/controllers/settingsController.js
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

exports.getSettings = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const where  = category ? 'WHERE category = $1' : '';
  const values = category ? [category] : [];
  const result = await query(`SELECT setting_key, value, data_type, category, description FROM v2_settings ${where} ORDER BY category, setting_key`, values);
  res.json({ success: true, data: result.rows });
});

exports.updateSetting = asyncHandler(async (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ success: false, error: 'value required' });

  const result = await query(
    `UPDATE v2_settings SET value=$1, updated_by=$2, updated_at=NOW()
     WHERE setting_key=$3 RETURNING *`,
    [String(value), req.user.id, req.params.key]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Setting not found' });
  res.json({ success: true, data: result.rows[0] });
});

exports.getCustomFields = asyncHandler(async (req, res) => {
  const { entity_type } = req.query;
  const where  = entity_type ? 'WHERE entity_type = $1' : '';
  const values = entity_type ? [entity_type] : [];
  const result = await query(
    `SELECT * FROM v2_custom_fields ${where} ORDER BY entity_type, sort_order`,
    values
  );
  res.json({ success: true, data: result.rows });
});

exports.createCustomField = asyncHandler(async (req, res) => {
  const { entity_type, field_key, label, field_type, options, is_required, sort_order } = req.body;
  if (!entity_type || !field_key || !label) {
    return res.status(400).json({ success: false, error: 'entity_type, field_key, label required' });
  }
  const result = await query(
    `INSERT INTO v2_custom_fields (entity_type, field_key, label, field_type, options, is_required, sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [entity_type, field_key, label, field_type||'text',
     options ? JSON.stringify(options) : null,
     is_required||false, sort_order||0, req.user.id]
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

exports.getFeatureFlags = asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM v2_feature_flags ORDER BY flag_key');
  res.json({ success: true, data: result.rows });
});

exports.toggleFeatureFlag = asyncHandler(async (req, res) => {
  const { is_enabled } = req.body;
  if (typeof is_enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'is_enabled (boolean) required' });
  }
  const result = await query(
    `UPDATE v2_feature_flags SET is_enabled=$1, updated_by=$2, updated_at=NOW()
     WHERE flag_key=$3 RETURNING *`,
    [is_enabled, req.user.id, req.params.key]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Flag not found' });
  res.json({ success: true, data: result.rows[0] });
});

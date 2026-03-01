// src/routes/index.js
const express = require('express');
const router  = express.Router();
const { authenticate, authorize, checkPermission } = require('../middleware/auth');
const { requireFeature, FLAGS } = require('../config/features');

// Controllers
const auth     = require('../controllers/authController');
const leads    = require('../controllers/leadController');
const calls    = require('../controllers/callController');
const reports  = require('../controllers/reportController');
const payments = require('../controllers/paymentController');
const settings = require('../controllers/settingsController');
const { healthCheck } = require('../config/database');

// ─────────────────────────────────────────
// Health check (public)
// ─────────────────────────────────────────
router.get('/health', async (req, res) => {
  const db = await healthCheck();
  res.json({ status: 'ok', version: 'v2', timestamp: new Date(), db });
});

// ─────────────────────────────────────────
// v1 Auth (all users)
// ─────────────────────────────────────────
router.post('/auth/login',           auth.login);
router.post('/auth/register',        authenticate, authorize('super_admin','admin'), auth.register);
router.get ('/auth/me',              authenticate, auth.me);
router.post('/auth/change-password', authenticate, auth.changePassword);

// ─────────────────────────────────────────
// v1 Leads (core - always available)
// ─────────────────────────────────────────
router.get   ('/leads',             authenticate, leads.index);
router.get   ('/leads/pipeline',    authenticate, leads.pipeline);
router.get   ('/leads/:id',         authenticate, leads.show);
router.post  ('/leads',             authenticate, checkPermission('leads','create'), leads.create);
router.put   ('/leads/:id',         authenticate, checkPermission('leads','update'), leads.update);
router.delete('/leads/:id',         authenticate, authorize('super_admin','admin'), leads.destroy);
router.put   ('/leads/:id/assign',  authenticate, authorize('super_admin','admin','manager'), leads.assign);
router.post  ('/leads/bulk-import', authenticate, authorize('super_admin','admin'), leads.bulkImport);

// ─────────────────────────────────────────
// v2 Module 01: Calls & Follow-ups
// ─────────────────────────────────────────
const ff01 = requireFeature(FLAGS.CALL_FOLLOWUP);

router.get ('/v2/calls',            authenticate, ff01, calls.listCalls);
router.post('/v2/calls',            authenticate, ff01, checkPermission('calls','create'), calls.createCall);
router.get ('/v2/call-scripts',     authenticate, ff01, calls.getCallScripts);

router.get ('/v2/followups',        authenticate, ff01, calls.listFollowups);
router.post('/v2/followups',        authenticate, ff01, checkPermission('followups','create'), calls.createFollowup);
router.put ('/v2/followups/:id',    authenticate, ff01, checkPermission('followups','update'), calls.updateFollowup);

// ─────────────────────────────────────────
// v2 Module 02: Lead Timeline
// ─────────────────────────────────────────
const ff02 = requireFeature(FLAGS.LEAD_TIMELINE);

router.get('/v2/timeline/:leadId',  authenticate, ff02, async (req, res) => {
  const { query } = require('../config/database');
  const result = await query(
    `SELECT t.*, u.full_name AS user_name
     FROM v2_lead_timeline t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.lead_id = $1
     ORDER BY t.occurred_at DESC`,
    [req.params.leadId]
  );
  res.json({ success: true, data: result.rows });
});

router.post('/v2/timeline/:leadId', authenticate, ff02, async (req, res) => {
  const { query } = require('../config/database');
  const { title, description, event_type = 'custom', metadata } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'title required' });
  const result = await query(
    `INSERT INTO v2_lead_timeline (lead_id, user_id, event_type, title, description, is_system, metadata)
     VALUES ($1,$2,$3,$4,$5,false,$6) RETURNING *`,
    [req.params.leadId, req.user.id, event_type, title, description,
     metadata ? JSON.stringify(metadata) : '{}']
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

// ─────────────────────────────────────────
// v2 Module 03: Master Settings
// ─────────────────────────────────────────
const ff03 = requireFeature(FLAGS.MASTER_SETTINGS);
const adminOnly = authorize('super_admin','admin');

router.get ('/v2/settings',               authenticate, ff03, settings.getSettings);
router.put ('/v2/settings/:key',          authenticate, ff03, adminOnly, settings.updateSetting);
router.get ('/v2/settings/custom-fields', authenticate, ff03, settings.getCustomFields);
router.post('/v2/settings/custom-fields', authenticate, ff03, adminOnly, settings.createCustomField);
router.get ('/v2/settings/flags',         authenticate, ff03, adminOnly, settings.getFeatureFlags);
router.put ('/v2/settings/flags/:key',    authenticate, ff03, adminOnly, settings.toggleFeatureFlag);

// ─────────────────────────────────────────
// v2 Module 04: Role Permissions
// ─────────────────────────────────────────
const ff04 = requireFeature(FLAGS.ROLE_PERMISSIONS);

router.get('/v2/permissions',     authenticate, ff04, adminOnly, async (req, res) => {
  const { query } = require('../config/database');
  const result = await query(`
    SELECT p.id, p.module, p.action, p.description,
           COALESCE(
             json_object_agg(rp.role, rp.granted) FILTER (WHERE rp.role IS NOT NULL),
             '{}'::json
           ) AS roles
    FROM v2_permissions p
    LEFT JOIN v2_role_permissions rp ON rp.permission_id = p.id
    GROUP BY p.id, p.module, p.action, p.description
    ORDER BY p.module, p.action
  `);
  res.json({ success: true, data: result.rows });
});

router.put('/v2/permissions/:id/role/:role', authenticate, ff04, adminOnly, async (req, res) => {
  const { query } = require('../config/database');
  const { granted } = req.body;
  await query(
    `INSERT INTO v2_role_permissions (role, permission_id, granted)
     VALUES ($1, $2, $3)
     ON CONFLICT (role, permission_id) DO UPDATE SET granted = $3`,
    [req.params.role, req.params.id, granted === true]
  );
  res.json({ success: true, message: 'Permission updated' });
});

// ─────────────────────────────────────────
// v2 Module 05: Reporting
// ─────────────────────────────────────────
const ff05 = requireFeature(FLAGS.REPORTING);

router.get('/v2/reports/dashboard',    authenticate, ff05, reports.dashboard);
router.get('/v2/reports/agents',       authenticate, ff05, checkPermission('reports','read'), reports.agentPerformance);
router.get('/v2/reports/sources',      authenticate, ff05, checkPermission('reports','read'), reports.leadSources);
router.get('/v2/reports/trend',        authenticate, ff05, checkPermission('reports','read'), reports.monthlyTrend);
router.get('/v2/reports/export-leads', authenticate, ff05, checkPermission('reports','export'), reports.exportLeads);

// ─────────────────────────────────────────
// v2 Module 06: Payments
// ─────────────────────────────────────────
const ff06 = requireFeature(FLAGS.PAYMENTS);

router.get ('/v2/payments',              authenticate, ff06, checkPermission('payments','read'),   payments.listPayments);
router.post('/v2/payments',              authenticate, ff06, checkPermission('payments','create'), payments.createPayment);
router.put ('/v2/payments/:id/complete', authenticate, ff06, adminOnly, payments.markCompleted);
router.get ('/v2/payments/commissions',  authenticate, ff06, payments.commissionReport);
router.post('/webhooks/stripe',          payments.stripeWebhook); // raw body needed, no auth

// ─────────────────────────────────────────
// Users management
// ─────────────────────────────────────────
router.get('/users',        authenticate, checkPermission('users','read'), async (req, res) => {
  const { query } = require('../config/database');
  const result = await query(
    'SELECT id, email, full_name, phone, role, is_active, last_login, created_at FROM users ORDER BY full_name'
  );
  res.json({ success: true, data: result.rows });
});

router.get('/users/agents', authenticate, async (req, res) => {
  const User = require('../models/User');
  const data = await User.getAgents();
  res.json({ success: true, data });
});

router.put('/users/:id/deactivate', authenticate, adminOnly, async (req, res) => {
  const { query } = require('../config/database');
  const result = await query(
    'UPDATE users SET is_active = false, updated_at = NOW() WHERE id=$1 RETURNING id, email, is_active',
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, data: result.rows[0] });
});

// Packages
router.get('/packages', authenticate, async (req, res) => {
  const { query } = require('../config/database');
  const result = await query("SELECT * FROM packages WHERE status = 'active' ORDER BY price_monthly");
  res.json({ success: true, data: result.rows });
});

module.exports = router;

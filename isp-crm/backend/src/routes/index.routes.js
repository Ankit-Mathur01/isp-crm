/**
 * index.routes.js
 * Aggregates all route modules under /api/v1
 */

const express = require('express');
const router  = express.Router();

const { authenticate, authorize }  = require('../middleware/auth.middleware');
const { auditLog }                  = require('../middleware/audit.middleware');
const { body, param }              = require('express-validator');

const authCtrl = require('../controllers/auth.controller');
const leadCtrl = require('../controllers/lead.controller');
const userCtrl = require('../controllers/user.controller');
const { query: dbQuery, getPoolStats } = require('../config/database');
const response = require('../utils/response');

// ═════════════════════════════════════════════════════════════════════════════
// AUTH Routes  — /api/v1/auth
// ═════════════════════════════════════════════════════════════════════════════
const authRouter = express.Router();

authRouter.post('/login',           authCtrl.login);
authRouter.post('/refresh',         authCtrl.refreshToken);
authRouter.post('/logout',          authenticate, authCtrl.logout);
authRouter.get('/me',               authenticate, authCtrl.getProfile);
authRouter.patch('/change-password',authenticate, authCtrl.changePassword);

router.use('/auth', authRouter);

// ═════════════════════════════════════════════════════════════════════════════
// LEADS Routes — /api/v1/leads
// ═════════════════════════════════════════════════════════════════════════════
const leadRouter = express.Router();
leadRouter.use(authenticate, auditLog);

// Dashboard & reports (must be before /:id to avoid param conflict)
leadRouter.get('/dashboard', leadCtrl.getDashboard);
leadRouter.get('/reports',   authorize('admin', 'sales', 'accounts', 'it'), leadCtrl.getReports);

// CRUD
leadRouter.get('/',    authorize('admin','sales','it','installation','accounts'), leadCtrl.getLeads);
leadRouter.post('/',   authorize('admin','sales'),
  [
    body('lead_source').notEmpty().isIn(['call','website','walkin','referral','advertisement','social_media','field_visit']),
    body('lead_type').notEmpty().isIn(['residential','commercial','enterprise','government','educational']),
    body('priority').optional().isIn(['hot','warm','cold']),
    body('customer_name').notEmpty().trim().isLength({ min: 2, max: 150 }),
    body('mobile').notEmpty().matches(/^[0-9]{10}$/),
    body('address').notEmpty().trim().isLength({ min: 5 }),
  ],
  leadCtrl.createLead
);

leadRouter.get('/:id', authorize('admin','sales','it','installation','accounts'), leadCtrl.getLeadById);

// Workflow endpoints
leadRouter.patch('/:id/feasibility', authorize('admin','it'),
  [
    body('feasibility_status').notEmpty().isIn(['feasible','not_feasible','infrastructure_required']),
    body('feasibility_notes').notEmpty().trim(),
  ],
  leadCtrl.updateFeasibility
);

leadRouter.patch('/:id/installation', authorize('admin','installation'),
  [
    body('installation_status').notEmpty().isIn(['installed','in_progress','failed']),
    body('installation_notes').notEmpty().trim(),
  ],
  leadCtrl.updateInstallation
);

leadRouter.patch('/:id/payment', authorize('admin','accounts'),
  [
    body('payment_status').notEmpty().isIn(['completed','partial']),
    body('payment_mode').notEmpty().isIn(['upi','cash','bank_transfer','neft_rtgs','cheque','credit_card','demand_draft']),
    body('transaction_id').notEmpty().trim(),
    body('amount_paid').notEmpty().isNumeric(),
  ],
  leadCtrl.updatePayment
);

leadRouter.patch('/:id/status', authorize('admin'), leadCtrl.adminUpdateStatus);

// Comments
leadRouter.post('/:id/comments',
  [ body('comment').notEmpty().trim() ],
  leadCtrl.addComment
);

leadRouter.get('/:id/comments', leadCtrl.getLeadById); // Returns comments inside lead

// Documents — handled separately
leadRouter.get('/:id/documents', async (req, res, next) => {
  try {
    const Lead = require('../models/lead.model');
    const docs = await Lead.getDocuments(req.params.id);
    return response.success(res, docs, 'Documents fetched');
  } catch (err) { next(err); }
});

router.use('/leads', leadRouter);

// ═════════════════════════════════════════════════════════════════════════════
// USERS Routes — /api/v1/users
// ═════════════════════════════════════════════════════════════════════════════
const userRouter = express.Router();
userRouter.use(authenticate);

userRouter.get('/',    authorize('admin'),                                userCtrl.getUsers);
userRouter.post('/',   authorize('admin'),                                userCtrl.createUser);
userRouter.get('/:id', authorize('admin'),                                userCtrl.getUserById);
userRouter.patch('/:id', authorize('admin'),                              userCtrl.updateUser);
userRouter.delete('/:id', authorize('admin'),                             userCtrl.deleteUser);

router.use('/users', userRouter);

// ═════════════════════════════════════════════════════════════════════════════
// AUDIT LOGS — /api/v1/audit
// ═════════════════════════════════════════════════════════════════════════════
router.get('/audit', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, entity_type, user_id, action, date_from } = req.query;
    const conds = [];
    const params = [];
    let idx = 1;

    if (entity_type) { conds.push(`entity_type = $${idx++}`); params.push(entity_type); }
    if (user_id)     { conds.push(`user_id = $${idx++}`);     params.push(user_id); }
    if (action)      { conds.push(`action ILIKE $${idx++}`);  params.push(`%${action}%`); }
    if (date_from)   { conds.push(`created_at >= $${idx++}`); params.push(date_from); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const base = `
      SELECT al.*, u.name AS user_name, u.employee_id
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${where}
      ORDER BY al.created_at DESC
    `;
    const { paginatedQuery } = require('../config/database');
    const result = await paginatedQuery(base, params, parseInt(page,10), parseInt(limit,10));
    return response.paginated(res, result.rows, result.pagination, 'Audit logs fetched');
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS — /api/v1/notifications
// ═════════════════════════════════════════════════════════════════════════════
const notifRouter = express.Router();
notifRouter.use(authenticate);

notifRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await dbQuery(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [req.user.id]
    );
    const unread = rows.filter(n => !n.is_read).length;
    return response.success(res, { notifications: rows, unread_count: unread });
  } catch (err) { next(err); }
});

notifRouter.patch('/read-all', async (req, res, next) => {
  try {
    await dbQuery(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = $1',
      [req.user.id]
    );
    return response.success(res, null, 'All notifications marked as read');
  } catch (err) { next(err); }
});

notifRouter.patch('/:id/read', async (req, res, next) => {
  try {
    await dbQuery(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    return response.success(res, null, 'Notification marked as read');
  } catch (err) { next(err); }
});

router.use('/notifications', notifRouter);

// ═════════════════════════════════════════════════════════════════════════════
// MASTER DATA — /api/v1/master
// ═════════════════════════════════════════════════════════════════════════════
router.get('/master/packages', authenticate, async (req, res, next) => {
  try {
    const { rows } = await dbQuery('SELECT * FROM packages WHERE is_active = TRUE ORDER BY monthly_price ASC');
    return response.success(res, rows, 'Packages fetched');
  } catch (err) { next(err); }
});

router.get('/master/areas', authenticate, async (req, res, next) => {
  try {
    const { rows } = await dbQuery('SELECT * FROM areas WHERE is_serviceable = TRUE ORDER BY name ASC');
    return response.success(res, rows, 'Areas fetched');
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK — /api/v1/health  (public)
// ═════════════════════════════════════════════════════════════════════════════
router.get('/health', async (req, res) => {
  try {
    const dbResult = await dbQuery('SELECT NOW() AS db_time');
    return res.json({
      status:    'ok',
      timestamp: new Date().toISOString(),
      database:  { status: 'connected', serverTime: dbResult.rows[0].db_time },
      pool:      getPoolStats(),
      uptime:    Math.floor(process.uptime()) + 's',
      env:       process.env.NODE_ENV,
    });
  } catch (err) {
    return res.status(503).json({ status: 'error', database: { status: 'disconnected', error: err.message } });
  }
});

module.exports = router;

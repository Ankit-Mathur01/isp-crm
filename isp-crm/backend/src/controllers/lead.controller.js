/**
 * lead.controller.js
 * Request handlers for all /leads routes.
 */

const Lead     = require('../models/lead.model');
const response = require('../utils/response');
const logger   = require('../utils/logger');
const { validationResult } = require('express-validator');

// ── Helper: extract validation errors ─────────────────────────────────────────
const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    response.badRequest(res, 'Validation failed', errors.array());
    return false;
  }
  return true;
};

// ── GET /leads ────────────────────────────────────────────────────────────────
const getLeads = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, ...filters } = req.query;

    // Sales team: restrict to their own leads
    if (req.user.role === 'sales') {
      filters.assigned_to = req.user.id;
    }
    // IT team: only feasibility-pending leads
    if (req.user.role === 'it') {
      filters.status = filters.status || 'feasibility_pending';
    }
    // Installation: only installation-pending
    if (req.user.role === 'installation') {
      filters.status = filters.status || 'installation_pending';
    }
    // Accounts: only payment-pending
    if (req.user.role === 'accounts') {
      filters.status = filters.status || 'payment_pending';
    }

    const result = await Lead.findAll(filters, parseInt(page, 10), parseInt(limit, 10));
    return response.paginated(res, result.rows, result.pagination, 'Leads fetched successfully');
  } catch (err) {
    next(err);
  }
};

// ── GET /leads/:id ────────────────────────────────────────────────────────────
const getLeadById = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return response.notFound(res, 'Lead not found');

    // Sales can only see their own leads
    if (req.user.role === 'sales' && lead.assigned_to !== req.user.id) {
      return response.forbidden(res, 'You can only view your own leads');
    }

    // Fetch associated data
    const [comments, documents] = await Promise.all([
      Lead.getComments(lead.id),
      Lead.getDocuments(lead.id),
    ]);

    return response.success(res, { ...lead, comments, documents }, 'Lead fetched');
  } catch (err) {
    next(err);
  }
};

// ── POST /leads ───────────────────────────────────────────────────────────────
const createLead = async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    // Auto-assign to creator if sales role
    if (req.user.role === 'sales' && !req.body.assigned_to) {
      req.body.assigned_to = req.user.id;
    }

    const lead = await Lead.create(req.body);
    logger.info('[Lead] Created', { ticketNumber: lead.ticket_number, userId: req.user.id });
    return response.created(res, lead, `Lead ${lead.ticket_number} created successfully`);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /leads/:id/feasibility ──────────────────────────────────────────────
const updateFeasibility = async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const lead = await Lead.findById(req.params.id);
    if (!lead) return response.notFound(res, 'Lead not found');

    if (!['new', 'feasibility_pending'].includes(lead.status)) {
      return response.badRequest(res, `Cannot update feasibility — current status: ${lead.status}`);
    }

    const updated = await Lead.updateFeasibility(lead.id, req.body, req.user.id);
    logger.info('[Lead] Feasibility updated', {
      ticketNumber: lead.ticket_number,
      decision:     req.body.feasibility_status,
      userId:       req.user.id,
    });

    return response.success(res, updated, `Feasibility marked as: ${req.body.feasibility_status}`);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /leads/:id/installation ────────────────────────────────────────────
const updateInstallation = async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const lead = await Lead.findById(req.params.id);
    if (!lead) return response.notFound(res, 'Lead not found');

    if (!['installation_pending', 'installation_in_progress'].includes(lead.status)) {
      return response.badRequest(res, `Cannot update installation — current status: ${lead.status}`);
    }

    const updated = await Lead.updateInstallation(lead.id, req.body, req.user.id);
    logger.info('[Lead] Installation updated', {
      ticketNumber: lead.ticket_number,
      status:       req.body.installation_status,
      userId:       req.user.id,
    });

    return response.success(res, updated, `Installation updated: ${req.body.installation_status}`);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /leads/:id/payment ──────────────────────────────────────────────────
const updatePayment = async (req, res, next) => {
  try {
    if (!validate(req, res)) return;

    const lead = await Lead.findById(req.params.id);
    if (!lead) return response.notFound(res, 'Lead not found');

    if (lead.installation_status !== 'installed') {
      return response.badRequest(res, 'Payment cannot be verified — installation not completed');
    }

    if (!['payment_pending', 'payment_partial'].includes(lead.status)) {
      return response.badRequest(res, `Cannot verify payment — current status: ${lead.status}`);
    }

    const updated = await Lead.updatePayment(lead.id, req.body, req.user.id);

    // Auto-create invoice record
    if (req.body.payment_status === 'completed') {
      await require('../config/database').query(`
        INSERT INTO invoices (lead_id, amount, total_amount, payment_mode, transaction_id, payment_status, paid_at, generated_by)
        VALUES ($1, $2, $2, $3, $4, 'completed', NOW(), $5)
        ON CONFLICT DO NOTHING
      `, [lead.id, lead.amount_due, req.body.payment_mode, req.body.transaction_id, req.user.id]);
    }

    logger.info('[Lead] Payment updated', {
      ticketNumber: lead.ticket_number,
      status:       req.body.payment_status,
      userId:       req.user.id,
    });

    const msg = req.body.payment_status === 'completed'
      ? `Payment verified — connection activated for ${lead.customer_name}`
      : 'Partial payment recorded';

    return response.success(res, updated, msg);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /leads/:id/status (admin override) ──────────────────────────────────
const adminUpdateStatus = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return response.notFound(res, 'Lead not found');

    const updated = await Lead.adminUpdateStatus(lead.id, req.body.status, req.user.id);
    logger.info('[Lead] Admin override', {
      ticketNumber: lead.ticket_number,
      newStatus:    req.body.status,
      adminId:      req.user.id,
    });

    return response.success(res, updated, `Status updated to: ${req.body.status}`);
  } catch (err) {
    next(err);
  }
};

// ── POST /leads/:id/comments ──────────────────────────────────────────────────
const addComment = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return response.notFound(res, 'Lead not found');

    const comment = await Lead.addComment(
      lead.id,
      req.user.id,
      req.body.comment,
      req.body.is_internal !== false,
    );

    return response.created(res, comment, 'Comment added');
  } catch (err) {
    next(err);
  }
};

// ── GET /leads/dashboard ──────────────────────────────────────────────────────
const getDashboard = async (req, res, next) => {
  try {
    const [stats, salesPerf, areaStats] = await Promise.all([
      Lead.getDashboardStats(req.user.id, req.user.role),
      req.user.role === 'admin' ? Lead.getSalesPerformance() : Promise.resolve([]),
      req.user.role === 'admin' ? Lead.getAreaStats()        : Promise.resolve([]),
    ]);

    return response.success(res, { stats, salesPerformance: salesPerf, areaStats }, 'Dashboard data');
  } catch (err) {
    next(err);
  }
};

// ── GET /leads/reports ────────────────────────────────────────────────────────
const getReports = async (req, res, next) => {
  try {
    const { date_from, date_to } = req.query;

    const [stats, salesPerf, areaStats] = await Promise.all([
      Lead.getDashboardStats(),
      Lead.getSalesPerformance(),
      Lead.getAreaStats(),
    ]);

    // Package breakdown
    const { rows: pkgStats } = await require('../config/database').query(`
      SELECT
        p.name          AS package_name,
        p.monthly_price,
        COUNT(l.id)     AS total_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'activated') AS activated,
        COALESCE(SUM(l.amount_due) FILTER (WHERE l.status = 'activated'), 0) AS revenue
      FROM packages p
      LEFT JOIN leads l ON l.package_id = p.id
      GROUP BY p.id, p.name, p.monthly_price
      ORDER BY revenue DESC
    `);

    // Status distribution
    const { rows: statusDist } = await require('../config/database').query(`
      SELECT status, COUNT(*) AS count
      FROM leads
      GROUP BY status
      ORDER BY count DESC
    `);

    return response.success(res, { stats, salesPerformance: salesPerf, areaStats, pkgStats, statusDist }, 'Reports generated');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getLeads,
  getLeadById,
  createLead,
  updateFeasibility,
  updateInstallation,
  updatePayment,
  adminUpdateStatus,
  addComment,
  getDashboard,
  getReports,
};

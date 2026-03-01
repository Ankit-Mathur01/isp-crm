// src/controllers/leadController.js
const Lead = require('../models/Lead');
const { asyncHandler } = require('../middleware/errorHandler');
const { query } = require('../config/database');
const Joi = require('joi');

const leadSchema = Joi.object({
  full_name:      Joi.string().min(2).max(150).required(),
  email:          Joi.string().email().optional().allow(null,''),
  phone:          Joi.string().max(30).required(),
  address:        Joi.string().optional().allow(null,''),
  city:           Joi.string().max(100).optional().allow(null,''),
  status:         Joi.string().valid('new','contacted','qualified','proposal','negotiation','won','lost').default('new'),
  source:         Joi.string().valid('website','referral','cold_call','social','email','event','other').default('other'),
  priority:       Joi.string().valid('low','medium','high','urgent').default('medium'),
  assigned_to:    Joi.string().uuid().optional().allow(null),
  package_id:     Joi.string().uuid().optional().allow(null),
  notes:          Joi.string().optional().allow(null,''),
  score:          Joi.number().integer().min(0).max(100).default(0),
  expected_value: Joi.number().min(0).optional().allow(null),
});

exports.index = asyncHandler(async (req, res) => {
  const { q, status, source, assigned_to, priority, min_score, max_score, page, page_size } = req.query;

  // Agents can only see their own leads
  const assignedFilter = req.user.role === 'agent' ? req.user.id : assigned_to;

  const result = await Lead.search({
    q, status, source,
    assignedTo: assignedFilter,
    priority,
    minScore: min_score !== undefined ? Number(min_score) : undefined,
    maxScore: max_score !== undefined ? Number(max_score) : undefined,
    page:     parseInt(page)      || 1,
    pageSize: parseInt(page_size) || 20,
  });

  res.json({ success: true, ...result });
});

exports.show = asyncHandler(async (req, res) => {
  const lead = await Lead.getDetail(req.params.id);
  if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

  // Agents restricted to their assigned leads
  if (req.user.role === 'agent' && lead.assigned_to !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  res.json({ success: true, data: lead });
});

exports.create = asyncHandler(async (req, res) => {
  const { error, value } = leadSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.details[0].message });

  const lead = await Lead.createWithTimeline(value, req.user.id);
  res.status(201).json({ success: true, data: lead });
});

exports.update = asyncHandler(async (req, res) => {
  const existing = await Lead.findById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Lead not found' });

  if (req.user.role === 'agent' && existing.assigned_to !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  const { error, value } = leadSchema.validate(req.body, { allowUnknown: false });
  if (error) return res.status(400).json({ success: false, error: error.details[0].message });

  const updated = await Lead.update(req.params.id, value);
  res.json({ success: true, data: updated });
});

exports.destroy = asyncHandler(async (req, res) => {
  const deleted = await Lead.delete(req.params.id);
  if (!deleted) return res.status(404).json({ success: false, error: 'Lead not found' });
  res.json({ success: true, message: 'Lead deleted' });
});

exports.pipeline = asyncHandler(async (req, res) => {
  const userId = req.user.role === 'agent' ? req.user.id : req.query.agent_id;
  const summary = await Lead.getPipelineSummary(userId || null);
  res.json({ success: true, data: summary });
});

exports.assign = asyncHandler(async (req, res) => {
  const { agent_id } = req.body;
  if (!agent_id) return res.status(400).json({ success: false, error: 'agent_id required' });

  const lead = await Lead.update(req.params.id, { assigned_to: agent_id });
  if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

  // Log timeline event
  await query(
    `INSERT INTO v2_lead_timeline (lead_id, user_id, event_type, title, is_system, metadata)
     VALUES ($1, $2, 'assigned', 'Lead reassigned', true, $3)`,
    [req.params.id, req.user.id, JSON.stringify({ to: agent_id, by: req.user.id })]
  ).catch(() => {});

  res.json({ success: true, data: lead });
});

exports.bulkImport = asyncHandler(async (req, res) => {
  const leads = req.body.leads;
  if (!Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ success: false, error: 'leads array required' });
  }
  if (leads.length > 500) {
    return res.status(400).json({ success: false, error: 'Maximum 500 leads per import' });
  }

  const results = { created: 0, failed: 0, errors: [] };
  for (const item of leads) {
    const { error, value } = leadSchema.validate(item);
    if (error) {
      results.failed++;
      results.errors.push({ data: item, reason: error.details[0].message });
      continue;
    }
    try {
      await Lead.createWithTimeline(value, req.user.id);
      results.created++;
    } catch (err) {
      results.failed++;
      results.errors.push({ data: item, reason: err.message });
    }
  }

  res.status(201).json({ success: true, data: results });
});

// src/controllers/callController.js
const { query, paginate } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const Joi = require('joi');

const callSchema = Joi.object({
  lead_id:       Joi.string().uuid().required(),
  direction:     Joi.string().valid('inbound','outbound').default('outbound'),
  disposition:   Joi.string().valid('answered','no_answer','busy','voicemail','wrong_number','callback_requested').default('answered'),
  duration_secs: Joi.number().integer().min(0).default(0),
  notes:         Joi.string().optional().allow(null,''),
  recording_url: Joi.string().uri().optional().allow(null,''),
  called_at:     Joi.date().iso().default(() => new Date()),
});

const followupSchema = Joi.object({
  lead_id:      Joi.string().uuid().required(),
  assigned_to:  Joi.string().uuid().required(),
  type:         Joi.string().valid('call','email','sms','meeting','demo','site_visit').default('call'),
  scheduled_at: Joi.date().iso().required(),
  notes:        Joi.string().optional().allow(null,''),
  priority:     Joi.string().valid('low','medium','high','urgent').default('medium'),
});

// ── Calls ───────────────────────────────
exports.listCalls = asyncHandler(async (req, res) => {
  const { lead_id, user_id, page, page_size } = req.query;
  const { limit, offset } = paginate(page, page_size);

  const conditions = [];
  const values     = [];
  let idx = 1;

  if (lead_id) { conditions.push(`c.lead_id = $${idx++}`); values.push(lead_id); }
  if (user_id) { conditions.push(`c.user_id = $${idx++}`); values.push(user_id); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const [count, data] = await Promise.all([
    query(`SELECT COUNT(*) FROM v2_calls c ${where}`, values),
    query(
      `SELECT c.*, l.full_name AS lead_name, u.full_name AS agent_name
       FROM v2_calls c
       JOIN leads l ON l.id = c.lead_id
       JOIN users u ON u.id = c.user_id
       ${where}
       ORDER BY c.called_at DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...values, limit, offset]
    ),
  ]);

  res.json({
    success: true,
    data:       data.rows,
    pagination: { total: parseInt(count.rows[0].count), page: parseInt(page)||1, pageSize: limit },
  });
});

exports.createCall = asyncHandler(async (req, res) => {
  const { error, value } = callSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.details[0].message });

  const result = await query(
    `INSERT INTO v2_calls (lead_id, user_id, direction, disposition, duration_secs, notes, recording_url, called_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [value.lead_id, req.user.id, value.direction, value.disposition,
     value.duration_secs, value.notes, value.recording_url, value.called_at]
  );

  // Add timeline event
  await query(
    `INSERT INTO v2_lead_timeline (lead_id, user_id, event_type, title, is_system, metadata)
     VALUES ($1, $2, $3, $4, true, $5)`,
    [value.lead_id, req.user.id,
     value.direction === 'inbound' ? 'call_received' : 'call_made',
     `${value.direction} call — ${value.disposition}`,
     JSON.stringify({ duration_secs: value.duration_secs, disposition: value.disposition })]
  ).catch(() => {});

  res.status(201).json({ success: true, data: result.rows[0] });
});

exports.getCallScripts = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT * FROM v2_call_scripts WHERE is_active = true ORDER BY name'
  );
  res.json({ success: true, data: result.rows });
});

// ── Follow-ups ──────────────────────────
exports.listFollowups = asyncHandler(async (req, res) => {
  const { lead_id, status, assigned_to, page, page_size, overdue } = req.query;
  const { limit, offset } = paginate(page, page_size);

  const conditions = [];
  const values     = [];
  let idx = 1;

  const agent = req.user.role === 'agent' ? req.user.id : assigned_to;
  if (agent)   { conditions.push(`f.assigned_to = $${idx++}`); values.push(agent); }
  if (lead_id) { conditions.push(`f.lead_id = $${idx++}`);     values.push(lead_id); }
  if (status)  { conditions.push(`f.status = $${idx++}`);      values.push(status); }
  if (overdue === 'true') {
    conditions.push(`f.scheduled_at < NOW() AND f.status = 'pending'`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const [count, data] = await Promise.all([
    query(`SELECT COUNT(*) FROM v2_followups f ${where}`, values),
    query(
      `SELECT f.*, l.full_name AS lead_name, l.phone AS lead_phone,
              u.full_name AS agent_name
       FROM v2_followups f
       JOIN leads l ON l.id = f.lead_id
       JOIN users u ON u.id = f.assigned_to
       ${where}
       ORDER BY f.scheduled_at ASC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...values, limit, offset]
    ),
  ]);

  res.json({
    success: true,
    data:       data.rows,
    pagination: { total: parseInt(count.rows[0].count), page: parseInt(page)||1, pageSize: limit },
  });
});

exports.createFollowup = asyncHandler(async (req, res) => {
  const { error, value } = followupSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.details[0].message });

  const result = await query(
    `INSERT INTO v2_followups (lead_id, assigned_to, created_by, type, scheduled_at, notes, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [value.lead_id, value.assigned_to, req.user.id,
     value.type, value.scheduled_at, value.notes, value.priority]
  );

  await query(
    `INSERT INTO v2_lead_timeline (lead_id, user_id, event_type, title, is_system, metadata)
     VALUES ($1,$2,'followup_scheduled',$3,true,$4)`,
    [value.lead_id, req.user.id,
     `Follow-up scheduled: ${value.type}`,
     JSON.stringify({ type: value.type, scheduled_at: value.scheduled_at })]
  ).catch(() => {});

  res.status(201).json({ success: true, data: result.rows[0] });
});

exports.updateFollowup = asyncHandler(async (req, res) => {
  const { status, notes, completed_at } = req.body;
  const result = await query(
    `UPDATE v2_followups SET status=$1, notes=COALESCE($2,notes), 
      completed_at=COALESCE($3,completed_at), updated_at=NOW()
     WHERE id=$4 RETURNING *`,
    [status, notes, completed_at, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Follow-up not found' });
  res.json({ success: true, data: result.rows[0] });
});

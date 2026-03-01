// src/controllers/paymentController.js
const { query, withTransaction, paginate } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const Joi = require('joi');

const paymentSchema = Joi.object({
  lead_id:    Joi.string().uuid().required(),
  package_id: Joi.string().uuid().optional().allow(null),
  amount:     Joi.number().positive().required(),
  currency:   Joi.string().length(3).default('USD'),
  method:     Joi.string().valid('stripe','bank_transfer','cash','cheque','other').default('stripe'),
  notes:      Joi.string().optional().allow(null,''),
});

exports.listPayments = asyncHandler(async (req, res) => {
  const { lead_id, status, page, page_size } = req.query;
  const { limit, offset } = paginate(page, page_size);

  const conditions = [];
  const values     = [];
  let idx = 1;

  if (lead_id) { conditions.push(`p.lead_id = $${idx++}`); values.push(lead_id); }
  if (status)  { conditions.push(`p.status = $${idx++}`);  values.push(status); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const [count, data] = await Promise.all([
    query(`SELECT COUNT(*) FROM v2_payments p ${where}`, values),
    query(
      `SELECT p.*, l.full_name AS lead_name, pk.name AS package_name
       FROM v2_payments p
       JOIN leads l ON l.id = p.lead_id
       LEFT JOIN packages pk ON pk.id = p.package_id
       ${where}
       ORDER BY p.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...values, limit, offset]
    ),
  ]);

  res.json({
    success: true,
    data: data.rows,
    pagination: { total: parseInt(count.rows[0].count), page: parseInt(page)||1, pageSize: limit },
  });
});

exports.createPayment = asyncHandler(async (req, res) => {
  const { error, value } = paymentSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.details[0].message });

  const payment = await withTransaction(async (client) => {
    // Create payment record
    const pResult = await client.query(
      `INSERT INTO v2_payments (lead_id, package_id, amount, currency, method, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [value.lead_id, value.package_id, value.amount, value.currency,
       value.method, value.notes, req.user.id]
    );
    const p = pResult.rows[0];

    // Auto-calculate commission if rules exist
    const ruleResult = await client.query(
      `SELECT * FROM v2_commission_rules 
       WHERE is_active = true AND min_payment <= $1
       LIMIT 1`,
      [value.amount]
    );
    
    if (ruleResult.rows[0]) {
      const rule = ruleResult.rows[0];
      const commAmt = rule.rate_type === 'percentage'
        ? parseFloat(value.amount) * (parseFloat(rule.rate) / 100)
        : parseFloat(rule.rate);

      // Find the assigned agent
      const leadRes = await client.query('SELECT assigned_to FROM leads WHERE id=$1', [value.lead_id]);
      const agentId = leadRes.rows[0]?.assigned_to;

      if (agentId) {
        await client.query(
          `INSERT INTO v2_commissions (payment_id, agent_id, rule_id, base_amount, rate, commission_amt)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [p.id, agentId, rule.id, value.amount, rule.rate, commAmt.toFixed(2)]
        );
      }
    }

    // Timeline event
    await client.query(
      `INSERT INTO v2_lead_timeline (lead_id, user_id, event_type, title, is_system, metadata)
       VALUES ($1,$2,'payment_received',$3,true,$4)`,
      [value.lead_id, req.user.id,
       `Payment received: $${value.amount}`,
       JSON.stringify({ amount: value.amount, method: value.method })]
    );

    return p;
  });

  res.status(201).json({ success: true, data: payment });
});

exports.markCompleted = asyncHandler(async (req, res) => {
  const result = await query(
    `UPDATE v2_payments SET status='completed', paid_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND status='pending' RETURNING *`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Payment not found or already completed' });
  res.json({ success: true, data: result.rows[0] });
});

// Stripe webhook handler
exports.stripeWebhook = asyncHandler(async (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Idempotency check
  const existing = await query(
    'SELECT id FROM v2_webhook_events WHERE external_id = $1',
    [event.id]
  );
  if (existing.rows[0]) return res.json({ received: true, duplicate: true });

  // Store event
  await query(
    `INSERT INTO v2_webhook_events (provider, event_type, external_id, payload)
     VALUES ('stripe', $1, $2, $3)`,
    [event.type, event.id, JSON.stringify(event)]
  );

  // Handle event types
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    await query(
      `UPDATE v2_payments SET status='completed', paid_at=NOW(), stripe_payment_id=$1
       WHERE stripe_payment_id=$1`,
      [pi.id]
    );
    await query(
      `UPDATE v2_webhook_events SET processed=true, processed_at=NOW() WHERE external_id=$1`,
      [event.id]
    );
  }

  res.json({ received: true });
});

exports.commissionReport = asyncHandler(async (req, res) => {
  const { agent_id, status } = req.query;
  const conditions = [];
  const values     = [];
  let idx = 1;

  const aid = req.user.role === 'agent' ? req.user.id : agent_id;
  if (aid)    { conditions.push(`c.agent_id = $${idx++}`); values.push(aid); }
  if (status) { conditions.push(`c.status = $${idx++}`);   values.push(status); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const result = await query(
    `SELECT c.*, u.full_name AS agent_name, p.amount AS payment_amount,
             l.full_name AS lead_name
     FROM v2_commissions c
     JOIN users u    ON u.id = c.agent_id
     JOIN v2_payments p ON p.id = c.payment_id
     JOIN leads l    ON l.id = p.lead_id
     ${where}
     ORDER BY c.created_at DESC`,
    values
  );
  res.json({ success: true, data: result.rows });
});

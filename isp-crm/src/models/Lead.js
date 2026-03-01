// src/models/Lead.js
const BaseModel = require('./BaseModel');
const { query, withTransaction } = require('../config/database');

class LeadModel extends BaseModel {
  constructor() {
    super('leads');
  }

  /**
   * Search leads with full-text search + filters
   */
  async search({ q, status, source, assignedTo, priority, minScore, maxScore, page = 1, pageSize = 20 }) {
    const conditions = [];
    const values = [];
    let idx = 1;

    if (q) {
      conditions.push(
        `to_tsvector('english', coalesce(full_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,''))
         @@ plainto_tsquery('english', $${idx})`
      );
      values.push(q);
      idx++;
    }
    if (status)     { conditions.push(`l.status = $${idx++}`);      values.push(status); }
    if (source)     { conditions.push(`l.source = $${idx++}`);      values.push(source); }
    if (assignedTo) { conditions.push(`l.assigned_to = $${idx++}`); values.push(assignedTo); }
    if (priority)   { conditions.push(`l.priority = $${idx++}`);    values.push(priority); }
    if (minScore !== undefined) { conditions.push(`l.score >= $${idx++}`); values.push(minScore); }
    if (maxScore !== undefined) { conditions.push(`l.score <= $${idx++}`); values.push(maxScore); }

    const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit  = Math.min(parseInt(pageSize) || 20, 100);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM leads l ${where}`, values),
      query(
        `SELECT l.*, 
                u.full_name AS assigned_to_name,
                p.name      AS package_name
         FROM leads l
         LEFT JOIN users    u ON u.id = l.assigned_to
         LEFT JOIN packages p ON p.id = l.package_id
         ${where}
         ORDER BY l.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset]
      ),
    ]);

    return {
      data: dataRes.rows,
      pagination: {
        total:      parseInt(countRes.rows[0].count),
        page:       parseInt(page),
        pageSize:   limit,
        totalPages: Math.ceil(parseInt(countRes.rows[0].count) / limit),
      },
    };
  }

  /**
   * Get lead with full details (calls, followups, timeline, custom fields)
   */
  async getDetail(leadId) {
    const [lead, calls, followups, timeline, customFields] = await Promise.all([
      query(
        `SELECT l.*, 
                u.full_name AS assigned_to_name, u.email AS assigned_to_email,
                p.name AS package_name, p.price_monthly
         FROM leads l
         LEFT JOIN users    u ON u.id = l.assigned_to
         LEFT JOIN packages p ON p.id = l.package_id
         WHERE l.id = $1`,
        [leadId]
      ),
      query(
        'SELECT * FROM v2_calls WHERE lead_id = $1 ORDER BY called_at DESC LIMIT 10',
        [leadId]
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT f.*, u.full_name AS assigned_to_name 
         FROM v2_followups f
         LEFT JOIN users u ON u.id = f.assigned_to
         WHERE f.lead_id = $1 AND f.status = 'pending'
         ORDER BY f.scheduled_at ASC`,
        [leadId]
      ).catch(() => ({ rows: [] })),
      query(
        'SELECT * FROM v2_lead_timeline WHERE lead_id = $1 ORDER BY occurred_at DESC LIMIT 20',
        [leadId]
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT cf.field_key, cf.label, cf.field_type, cfv.value_text
         FROM v2_custom_fields cf
         LEFT JOIN v2_custom_field_values cfv ON cfv.field_id = cf.id AND cfv.entity_id = $1
         WHERE cf.entity_type = 'lead' AND cf.is_visible = true
         ORDER BY cf.sort_order`,
        [leadId]
      ).catch(() => ({ rows: [] })),
    ]);

    if (!lead.rows[0]) return null;
    return {
      ...lead.rows[0],
      calls:        calls.rows,
      followups:    followups.rows,
      timeline:     timeline.rows,
      customFields: customFields.rows,
    };
  }

  /**
   * Create lead and auto-insert timeline event
   */
  async createWithTimeline(data, createdBy) {
    return withTransaction(async (client) => {
      const leadResult = await client.query(
        `INSERT INTO leads (full_name, email, phone, address, city, status, source, priority,
                            assigned_to, package_id, notes, score, expected_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [data.full_name, data.email, data.phone, data.address, data.city,
         data.status || 'new', data.source || 'other', data.priority || 'medium',
         data.assigned_to || null, data.package_id || null,
         data.notes || null, data.score || 0, data.expected_value || null]
      );
      const lead = leadResult.rows[0];

      // Insert timeline event
      await client.query(
        `INSERT INTO v2_lead_timeline (lead_id, user_id, event_type, title, is_system, metadata)
         VALUES ($1, $2, 'created', 'Lead created', true, $3)`,
        [lead.id, createdBy, JSON.stringify({ source: lead.source, status: lead.status })]
      );

      return lead;
    });
  }

  /**
   * Get pipeline summary (grouped by status)
   */
  async getPipelineSummary(userId = null) {
    const where  = userId ? 'WHERE assigned_to = $1' : '';
    const values = userId ? [userId] : [];
    const result = await query(
      `SELECT status,
              COUNT(*)            AS count,
              SUM(expected_value) AS total_value
       FROM leads
       ${where}
       GROUP BY status
       ORDER BY CASE status
         WHEN 'new' THEN 1 WHEN 'contacted' THEN 2 WHEN 'qualified' THEN 3
         WHEN 'proposal' THEN 4 WHEN 'negotiation' THEN 5 WHEN 'won' THEN 6
         ELSE 7 END`,
      values
    );
    return result.rows;
  }
}

module.exports = new LeadModel();

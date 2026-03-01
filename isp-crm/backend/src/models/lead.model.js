/**
 * lead.model.js
 * All PostgreSQL queries related to leads.
 * Controllers call these functions — no raw SQL in controllers.
 */

const db     = require('../config/database');
const logger = require('../utils/logger');

// ── Build dynamic WHERE clause from filters ────────────────────────────────────
const buildWhereClause = (filters, startIdx = 1) => {
  const conditions = [];
  const params     = [];
  let   idx        = startIdx;

  if (filters.status) {
    conditions.push(`l.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.priority) {
    conditions.push(`l.priority = $${idx++}`);
    params.push(filters.priority);
  }
  if (filters.lead_source) {
    conditions.push(`l.lead_source = $${idx++}`);
    params.push(filters.lead_source);
  }
  if (filters.assigned_to) {
    conditions.push(`l.assigned_to = $${idx++}`);
    params.push(filters.assigned_to);
  }
  if (filters.area_id) {
    conditions.push(`l.area_id = $${idx++}`);
    params.push(filters.area_id);
  }
  if (filters.date_from) {
    conditions.push(`l.created_at >= $${idx++}`);
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push(`l.created_at <= $${idx++}`);
    params.push(filters.date_to + 'T23:59:59Z');
  }
  if (filters.search) {
    conditions.push(`(
      l.customer_name ILIKE $${idx}  OR
      l.ticket_number ILIKE $${idx}  OR
      l.mobile        ILIKE $${idx}  OR
      l.address       ILIKE $${idx}
    )`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  return {
    whereClause: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '',
    params,
    nextIdx: idx,
  };
};

// ── Base SELECT for list queries ───────────────────────────────────────────────
const BASE_SELECT = `
  SELECT
    l.id, l.ticket_number, l.lead_source, l.lead_type, l.priority,
    l.customer_name, l.mobile, l.alt_mobile, l.email,
    l.address, l.pincode, l.landmark,
    l.status, l.feasibility_status, l.installation_status,
    l.payment_status, l.amount_due, l.amount_paid,
    l.created_at, l.updated_at,
    a.name       AS area_name,
    p.name       AS package_name,
    p.monthly_price,
    u.name       AS salesperson_name
  FROM leads l
  LEFT JOIN areas    a ON l.area_id    = a.id
  LEFT JOIN packages p ON l.package_id = p.id
  LEFT JOIN users    u ON l.assigned_to = u.id
`;

// ── CRUD ──────────────────────────────────────────────────────────────────────

const findAll = async (filters = {}, page = 1, limit = 20) => {
  const { whereClause, params } = buildWhereClause(filters);
  const orderBy = `ORDER BY l.created_at DESC`;
  const baseQuery = `${BASE_SELECT} ${whereClause} ${orderBy}`;
  return db.paginatedQuery(baseQuery, params, page, limit);
};

const findById = async (id) => {
  const { rows } = await db.query(`
    SELECT
      l.*,
      a.name         AS area_name,
      a.city         AS area_city,
      a.pincode      AS area_pincode,
      p.name         AS package_name,
      p.speed_mbps   AS package_speed,
      p.monthly_price,
      u_s.name       AS salesperson_name,
      u_s.email      AS salesperson_email,
      u_f.name       AS feasibility_by_name,
      u_i.name       AS installation_by_name,
      u_p.name       AS payment_verified_by_name,
      u_a.name       AS activated_by_name
    FROM leads l
    LEFT JOIN areas    a   ON l.area_id             = a.id
    LEFT JOIN packages p   ON l.package_id          = p.id
    LEFT JOIN users    u_s ON l.assigned_to          = u_s.id
    LEFT JOIN users    u_f ON l.feasibility_by       = u_f.id
    LEFT JOIN users    u_i ON l.installation_by      = u_i.id
    LEFT JOIN users    u_p ON l.payment_verified_by  = u_p.id
    LEFT JOIN users    u_a ON l.activated_by         = u_a.id
    WHERE l.id = $1 OR l.ticket_number = $1
  `, [id]);
  return rows[0] || null;
};

const create = async (data) => {
  const {
    lead_source, lead_type, priority = 'warm',
    customer_name, mobile, alt_mobile, email,
    address, area_id, pincode, landmark, gps_lat, gps_lng,
    package_id, assigned_to, internal_notes,
  } = data;

  const { rows } = await db.query(`
    INSERT INTO leads (
      lead_source, lead_type, priority,
      customer_name, mobile, alt_mobile, email,
      address, area_id, pincode, landmark, gps_lat, gps_lng,
      package_id, assigned_to, internal_notes,
      status
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'new'
    ) RETURNING *
  `, [
    lead_source, lead_type, priority,
    customer_name, mobile, alt_mobile || null, email || null,
    address, area_id || null, pincode || null, landmark || null,
    gps_lat || null, gps_lng || null,
    package_id || null, assigned_to || null, internal_notes || null,
  ]);

  // Set amount_due from package price
  if (package_id && rows[0]) {
    const pkg = await db.query('SELECT monthly_price FROM packages WHERE id = $1', [package_id]);
    if (pkg.rows.length) {
      await db.query('UPDATE leads SET amount_due = $1 WHERE id = $2', [pkg.rows[0].monthly_price, rows[0].id]);
    }
  }

  return findById(rows[0].id);
};

const updateFeasibility = async (leadId, data, userId) => {
  const { feasibility_status, feasibility_notes } = data;

  const statusMap = {
    feasible:               'installation_pending',
    not_feasible:           'not_feasible',
    infrastructure_required:'infrastructure_required',
  };

  const newLeadStatus = statusMap[feasibility_status] || 'feasibility_pending';

  const { rows } = await db.query(`
    UPDATE leads SET
      feasibility_status = $1,
      feasibility_notes  = $2,
      feasibility_by     = $3,
      feasibility_at     = NOW(),
      status             = $4,
      updated_at         = NOW()
    WHERE id = $5
    RETURNING *
  `, [feasibility_status, feasibility_notes, userId, newLeadStatus, leadId]);

  return rows[0] || null;
};

const updateInstallation = async (leadId, data, userId) => {
  const { installation_status, installation_notes, installation_date, equipment_details } = data;

  const statusMap = {
    installed:   'payment_pending',
    in_progress: 'installation_in_progress',
    failed:      'installation_failed',
  };

  const newLeadStatus = statusMap[installation_status] || 'installation_pending';

  const { rows } = await db.query(`
    UPDATE leads SET
      installation_status  = $1,
      installation_notes   = $2,
      installation_by      = $3,
      installation_date    = $4,
      equipment_details    = $5,
      status               = $6,
      updated_at           = NOW()
    WHERE id = $7
    RETURNING *
  `, [
    installation_status,
    installation_notes,
    userId,
    installation_date || null,
    JSON.stringify(equipment_details || {}),
    newLeadStatus,
    leadId,
  ]);

  return rows[0] || null;
};

const updatePayment = async (leadId, data, userId) => {
  const { payment_status, payment_mode, transaction_id, amount_paid } = data;

  const newLeadStatus = payment_status === 'completed' ? 'activated' : 'payment_partial';

  const { rows } = await db.query(`
    UPDATE leads SET
      payment_status       = $1,
      payment_mode         = $2,
      transaction_id       = $3,
      amount_paid          = $4,
      payment_verified_by  = $5,
      payment_verified_at  = NOW(),
      status               = $6,
      activated_at         = CASE WHEN $1 = 'completed' THEN NOW() ELSE activated_at END,
      activated_by         = CASE WHEN $1 = 'completed' THEN $5 ELSE activated_by END,
      updated_at           = NOW()
    WHERE id = $7
    RETURNING *
  `, [payment_status, payment_mode, transaction_id, amount_paid, userId, newLeadStatus, leadId]);

  return rows[0] || null;
};

const adminUpdateStatus = async (leadId, status, userId) => {
  const { rows } = await db.query(`
    UPDATE leads SET
      status     = $1,
      updated_at = NOW(),
      activated_at = CASE WHEN $1 = 'activated' THEN NOW() ELSE activated_at END,
      activated_by = CASE WHEN $1 = 'activated' THEN $2 ELSE activated_by END
    WHERE id = $3
    RETURNING *
  `, [status, userId, leadId]);
  return rows[0] || null;
};

const getComments = async (leadId) => {
  const { rows } = await db.query(`
    SELECT
      c.id, c.comment, c.is_internal, c.created_at,
      u.name AS author_name, u.role AS author_role
    FROM lead_comments c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.lead_id = $1
    ORDER BY c.created_at ASC
  `, [leadId]);
  return rows;
};

const addComment = async (leadId, userId, comment, isInternal = true) => {
  const { rows } = await db.query(`
    INSERT INTO lead_comments (lead_id, user_id, comment, is_internal)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [leadId, userId, comment, isInternal]);
  return rows[0];
};

const getDocuments = async (leadId) => {
  const { rows } = await db.query(`
    SELECT d.*, u.name AS uploaded_by_name
    FROM lead_documents d
    LEFT JOIN users u ON d.uploaded_by = u.id
    WHERE d.lead_id = $1
    ORDER BY d.created_at DESC
  `, [leadId]);
  return rows;
};

const addDocument = async (leadId, userId, fileData) => {
  const { rows } = await db.query(`
    INSERT INTO lead_documents (lead_id, uploaded_by, file_name, original_name, file_path, file_size, mime_type, doc_type)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
  `, [leadId, userId, fileData.fileName, fileData.originalName, fileData.filePath,
      fileData.fileSize, fileData.mimeType, fileData.docType || 'general']);
  return rows[0];
};

// ── Dashboard stats ────────────────────────────────────────────────────────────
const getDashboardStats = async (userId = null, role = null) => {
  // For sales role: only their own leads
  const whereClause = (role === 'sales' && userId)
    ? `WHERE assigned_to = '${userId}'`
    : '';

  const { rows } = await db.query(`
    SELECT
      COUNT(*)                                                                 AS total_leads,
      COUNT(*) FILTER (WHERE status = 'new')                                  AS new_leads,
      COUNT(*) FILTER (WHERE status IN ('new','feasibility_pending'))         AS feasibility_queue,
      COUNT(*) FILTER (WHERE status IN ('installation_pending','installation_in_progress')) AS installation_queue,
      COUNT(*) FILTER (WHERE status IN ('payment_pending','payment_partial')) AS payment_queue,
      COUNT(*) FILTER (WHERE status = 'activated')                            AS activated,
      COUNT(*) FILTER (WHERE status IN ('not_feasible','closed','installation_failed')) AS closed_lost,
      COALESCE(SUM(amount_due)  FILTER (WHERE status = 'activated'),0)        AS total_revenue,
      COALESCE(SUM(amount_due)  FILTER (WHERE payment_status IN ('pending','partial')), 0) AS pending_revenue,
      COALESCE(SUM(amount_paid) FILTER (WHERE status = 'activated'), 0)       AS collected_revenue
    FROM leads ${whereClause}
  `);
  return rows[0];
};

const getSalesPerformance = async () => {
  const { rows } = await db.query(`
    SELECT
      u.id, u.name AS salesperson_name, u.employee_id,
      COUNT(l.id)                                              AS total_leads,
      COUNT(l.id) FILTER (WHERE l.status = 'activated')       AS activated,
      COUNT(l.id) FILTER (WHERE l.status = 'not_feasible')    AS not_feasible,
      COALESCE(SUM(l.amount_due) FILTER (WHERE l.status = 'activated'), 0) AS revenue,
      CASE WHEN COUNT(l.id) > 0
        THEN ROUND(COUNT(l.id) FILTER (WHERE l.status = 'activated')::NUMERIC / COUNT(l.id) * 100, 1)
        ELSE 0 END AS conversion_rate
    FROM users u
    LEFT JOIN leads l ON l.assigned_to = u.id
    WHERE u.role = 'sales'
    GROUP BY u.id, u.name, u.employee_id
    ORDER BY revenue DESC
  `);
  return rows;
};

const getAreaStats = async () => {
  const { rows } = await db.query(`
    SELECT
      a.id, a.name AS area_name,
      COUNT(l.id)                                              AS total_leads,
      COUNT(l.id) FILTER (WHERE l.feasibility_status = 'feasible') AS feasible,
      COUNT(l.id) FILTER (WHERE l.feasibility_status = 'not_feasible') AS not_feasible,
      COUNT(l.id) FILTER (WHERE l.status = 'activated')       AS activated,
      CASE WHEN COUNT(l.id) FILTER (WHERE l.feasibility_status != 'pending') > 0
        THEN ROUND(
          COUNT(l.id) FILTER (WHERE l.feasibility_status = 'feasible')::NUMERIC /
          NULLIF(COUNT(l.id) FILTER (WHERE l.feasibility_status != 'pending'),0) * 100, 1)
        ELSE 0 END AS feasibility_rate
    FROM areas a
    LEFT JOIN leads l ON l.area_id = a.id
    GROUP BY a.id, a.name
    ORDER BY total_leads DESC
  `);
  return rows;
};

module.exports = {
  findAll,
  findById,
  create,
  updateFeasibility,
  updateInstallation,
  updatePayment,
  adminUpdateStatus,
  getComments,
  addComment,
  getDocuments,
  addDocument,
  getDashboardStats,
  getSalesPerformance,
  getAreaStats,
};

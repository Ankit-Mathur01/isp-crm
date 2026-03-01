// src/controllers/reportController.js
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const ExcelJS = require('exceljs');

// ── Agent Performance ───────────────────
exports.agentPerformance = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const dateFilter = from && to
    ? `AND l.created_at BETWEEN $1 AND $2`
    : '';
  const values = from && to ? [from, to] : [];

  const result = await query(
    `SELECT
       u.id, u.full_name, u.email,
       COUNT(l.id)                                         AS total_leads,
       COUNT(l.id) FILTER (WHERE l.status = 'won')         AS won,
       COUNT(l.id) FILTER (WHERE l.status = 'lost')        AS lost,
       COUNT(l.id) FILTER (WHERE l.status NOT IN ('won','lost')) AS active,
       ROUND(COUNT(l.id) FILTER (WHERE l.status = 'won')::NUMERIC
         / NULLIF(COUNT(l.id),0)*100, 2)                   AS conversion_pct,
       COALESCE(SUM(l.expected_value) FILTER (WHERE l.status='won'),0) AS revenue
     FROM users u
     LEFT JOIN leads l ON l.assigned_to = u.id ${dateFilter}
     WHERE u.is_active = true AND u.role IN ('agent','manager')
     GROUP BY u.id, u.full_name, u.email
     ORDER BY revenue DESC`,
    values
  );
  res.json({ success: true, data: result.rows });
});

// ── Lead Sources ────────────────────────
exports.leadSources = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT source,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'won') AS converted,
            ROUND(COUNT(*) FILTER (WHERE status='won')::NUMERIC / NULLIF(COUNT(*),0)*100,2) AS rate
     FROM leads
     GROUP BY source ORDER BY total DESC`
  );
  res.json({ success: true, data: result.rows });
});

// ── Monthly Trend ───────────────────────
exports.monthlyTrend = asyncHandler(async (req, res) => {
  const { months = 12 } = req.query;
  const result = await query(
    `SELECT DATE_TRUNC('month', created_at)::DATE AS month,
            COUNT(*) AS new_leads,
            COUNT(*) FILTER (WHERE status='won') AS converted,
            COALESCE(SUM(expected_value) FILTER (WHERE status='won'),0) AS revenue
     FROM leads
     WHERE created_at >= NOW() - INTERVAL '${parseInt(months)} months'
     GROUP BY 1 ORDER BY 1`
  );
  res.json({ success: true, data: result.rows });
});

// ── Dashboard Summary ───────────────────
exports.dashboard = asyncHandler(async (req, res) => {
  const userId = req.user.role === 'agent' ? req.user.id : null;
  const filter = userId ? 'WHERE assigned_to = $1' : '';
  const vals   = userId ? [userId] : [];

  const [leadsStats, followupStats, callStats, recentLeads] = await Promise.all([
    query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status='new') AS new_leads,
         COUNT(*) FILTER (WHERE status='won') AS won,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS this_month,
         COALESCE(SUM(expected_value) FILTER (WHERE status='won'),0) AS total_revenue
       FROM leads ${filter}`, vals
    ),
    query(
      `SELECT
         COUNT(*) FILTER (WHERE status='pending') AS pending,
         COUNT(*) FILTER (WHERE status='pending' AND scheduled_at < NOW()) AS overdue
       FROM v2_followups ${userId ? 'WHERE assigned_to = $1' : ''}`, vals
    ).catch(() => ({ rows: [{ pending: 0, overdue: 0 }] })),
    query(
      `SELECT COUNT(*) AS today FROM v2_calls
       WHERE DATE(called_at) = CURRENT_DATE
         ${userId ? 'AND user_id = $1' : ''}`, vals
    ).catch(() => ({ rows: [{ today: 0 }] })),
    query(
      `SELECT l.id, l.full_name, l.status, l.phone, l.created_at,
              u.full_name AS assigned_to_name
       FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
       ${filter}
       ORDER BY l.created_at DESC LIMIT 5`, vals
    ),
  ]);

  res.json({
    success: true,
    data: {
      leads:     leadsStats.rows[0],
      followups: followupStats.rows[0],
      calls:     callStats.rows[0],
      recent:    recentLeads.rows,
    },
  });
});

// ── Export Leads to Excel ───────────────
exports.exportLeads = asyncHandler(async (req, res) => {
  const { status, from, to } = req.query;
  const conditions = [];
  const values     = [];
  let idx = 1;

  if (status) { conditions.push(`l.status = $${idx++}`); values.push(status); }
  if (from)   { conditions.push(`l.created_at >= $${idx++}`); values.push(from); }
  if (to)     { conditions.push(`l.created_at <= $${idx++}`); values.push(to); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const result = await query(
    `SELECT l.full_name, l.email, l.phone, l.city, l.status, l.source, l.priority,
            l.score, l.expected_value, l.created_at,
            u.full_name AS agent, p.name AS package
     FROM leads l
     LEFT JOIN users    u ON u.id = l.assigned_to
     LEFT JOIN packages p ON p.id = l.package_id
     ${where} ORDER BY l.created_at DESC`,
    values
  );

  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Leads');
  worksheet.columns = [
    { header: 'Full Name',       key: 'full_name',      width: 25 },
    { header: 'Email',           key: 'email',          width: 30 },
    { header: 'Phone',           key: 'phone',          width: 18 },
    { header: 'City',            key: 'city',           width: 18 },
    { header: 'Status',          key: 'status',         width: 15 },
    { header: 'Source',          key: 'source',         width: 15 },
    { header: 'Priority',        key: 'priority',       width: 12 },
    { header: 'Score',           key: 'score',          width: 10 },
    { header: 'Expected Value',  key: 'expected_value', width: 18 },
    { header: 'Agent',           key: 'agent',          width: 25 },
    { header: 'Package',         key: 'package',        width: 25 },
    { header: 'Created At',      key: 'created_at',     width: 20 },
  ];

  worksheet.getRow(1).font = { bold: true };
  result.rows.forEach(row => worksheet.addRow(row));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=leads-export-${Date.now()}.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
});

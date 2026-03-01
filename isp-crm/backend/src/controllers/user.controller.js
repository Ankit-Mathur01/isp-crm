/**
 * user.controller.js
 * CRUD for CRM users (admin only for most operations).
 */

const bcrypt   = require('bcryptjs');
const { query, paginatedQuery } = require('../config/database');
const response = require('../utils/response');
const logger   = require('../utils/logger');

// ── GET /users ────────────────────────────────────────────────────────────────
const getUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, role, status, search } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role)   { conditions.push(`role = $${idx++}`);   params.push(role); }
    if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
    if (search) {
      conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR employee_id ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const base  = `SELECT id, employee_id, name, email, role, status, phone, last_login_at, created_at
                   FROM users ${where} ORDER BY created_at DESC`;

    const result = await paginatedQuery(base, params, parseInt(page, 10), parseInt(limit, 10));
    return response.paginated(res, result.rows, result.pagination, 'Users fetched');
  } catch (err) {
    next(err);
  }
};

// ── GET /users/:id ────────────────────────────────────────────────────────────
const getUserById = async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, employee_id, name, email, role, status, phone, last_login_at, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return response.notFound(res, 'User not found');
    return response.success(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

// ── POST /users ───────────────────────────────────────────────────────────────
const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, phone } = req.body;

    if (!name || !email || !password || !role) {
      return response.badRequest(res, 'name, email, password, and role are required');
    }

    // Check duplicate email
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) return response.conflict(res, 'Email already registered');

    // Auto-generate employee_id
    const { rows: countRows } = await query('SELECT COUNT(*) AS cnt FROM users');
    const empId = `EMP-${String(parseInt(countRows[0].cnt, 10) + 1).padStart(3, '0')}`;

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await query(`
      INSERT INTO users (employee_id, name, email, password_hash, role, phone)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, employee_id, name, email, role, status, created_at
    `, [empId, name, email.toLowerCase(), passwordHash, role, phone || null]);

    logger.info('[User] Created', { name, role, by: req.user.id });
    return response.created(res, rows[0], 'User created successfully');
  } catch (err) {
    next(err);
  }
};

// ── PATCH /users/:id ──────────────────────────────────────────────────────────
const updateUser = async (req, res, next) => {
  try {
    const { name, phone, status, role } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;

    if (name)   { fields.push(`name = $${idx++}`);   params.push(name); }
    if (phone)  { fields.push(`phone = $${idx++}`);  params.push(phone); }
    if (status && req.user.role === 'admin') { fields.push(`status = $${idx++}`); params.push(status); }
    if (role   && req.user.role === 'admin') { fields.push(`role = $${idx++}`);   params.push(role); }

    if (!fields.length) return response.badRequest(res, 'No fields to update');

    fields.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const { rows } = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, name, email, role, status`,
      params
    );
    if (!rows.length) return response.notFound(res, 'User not found');

    return response.success(res, rows[0], 'User updated');
  } catch (err) {
    next(err);
  }
};

// ── DELETE /users/:id (soft-delete = suspend) ─────────────────────────────────
const deleteUser = async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return response.badRequest(res, 'Cannot deactivate your own account');
    }
    const { rows } = await query(
      "UPDATE users SET status = 'inactive', updated_at = NOW() WHERE id = $1 RETURNING id, name",
      [req.params.id]
    );
    if (!rows.length) return response.notFound(res, 'User not found');

    logger.info('[User] Deactivated', { userId: req.params.id, by: req.user.id });
    return response.success(res, rows[0], 'User deactivated');
  } catch (err) {
    next(err);
  }
};

module.exports = { getUsers, getUserById, createUser, updateUser, deleteUser };

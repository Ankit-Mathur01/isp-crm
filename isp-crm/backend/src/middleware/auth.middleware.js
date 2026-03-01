/**
 * auth.middleware.js
 * JWT authentication + role-based authorization middleware.
 */

const jwt    = require('jsonwebtoken');
const { query } = require('../config/database');
const response  = require('../utils/response');
const logger    = require('../utils/logger');

// ── Verify JWT token ──────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return response.unauthorized(res, 'Authorization token is required');
    }

    const token = authHeader.split(' ')[1];
    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return response.unauthorized(res, 'Token has expired — please login again');
      }
      return response.unauthorized(res, 'Invalid token');
    }

    // Fetch user from DB (validates user still active)
    const { rows } = await query(
      'SELECT id, name, email, role, status, employee_id FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!rows.length || rows[0].status !== 'active') {
      return response.unauthorized(res, 'Account not found or deactivated');
    }

    // Attach to request
    req.user = {
      id:         rows[0].id,
      name:       rows[0].name,
      email:      rows[0].email,
      role:       rows[0].role,
      employeeId: rows[0].employee_id,
    };

    next();
  } catch (err) {
    logger.error('[Auth] Authentication error', { error: err.message });
    return response.error(res, 'Authentication failed');
  }
};

// ── Role authorization factory ────────────────────────────────────────────────
/**
 * Usage: authorize('admin', 'sales')
 * Allows any of the listed roles. Admin always passes.
 */
const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) return response.unauthorized(res);

  // Admin has full access to everything
  if (req.user.role === 'admin') return next();

  if (!allowedRoles.includes(req.user.role)) {
    logger.warn('[Auth] Forbidden access attempt', {
      userId:       req.user.id,
      userRole:     req.user.role,
      allowedRoles,
      path:         req.path,
      method:       req.method,
    });
    return response.forbidden(res);
  }

  next();
};

// ── Self-or-admin guard ───────────────────────────────────────────────────────
// Used for routes like PATCH /users/:id — user can only edit themselves
const selfOrAdmin = (paramName = 'id') => (req, res, next) => {
  if (!req.user) return response.unauthorized(res);
  if (req.user.role === 'admin' || req.user.id === req.params[paramName]) {
    return next();
  }
  return response.forbidden(res, 'You can only modify your own profile');
};

module.exports = { authenticate, authorize, selfOrAdmin };

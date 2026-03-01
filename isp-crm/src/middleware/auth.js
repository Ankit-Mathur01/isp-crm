// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await query(
      'SELECT id, email, full_name, role, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (!result.rows[0] || !result.rows[0].is_active) {
      return res.status(401).json({ success: false, error: 'Invalid or inactive user' });
    }
    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expired' });
    }
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions',
      required: roles,
      current: req.user.role,
    });
  }
  next();
};

// v2 permission check via DB
const checkPermission = (module, action) => async (req, res, next) => {
  try {
    const result = await query(
      `SELECT rp.granted FROM v2_role_permissions rp
       JOIN v2_permissions p ON p.id = rp.permission_id
       WHERE rp.role = $1 AND p.module = $2 AND p.action = $3`,
      [req.user.role, module, action]
    );
    if (!result.rows[0]?.granted) {
      return res.status(403).json({
        success: false,
        error: `Permission denied: ${module}.${action}`,
      });
    }
    next();
  } catch {
    next(); // fail open if permissions table not yet migrated
  }
};

module.exports = { authenticate, authorize, checkPermission };

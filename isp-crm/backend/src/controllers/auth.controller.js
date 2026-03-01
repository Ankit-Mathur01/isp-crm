/**
 * auth.controller.js
 * Handles login, token refresh, logout, and profile.
 */

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { query, withTransaction } = require('../config/database');
const response = require('../utils/response');
const logger   = require('../utils/logger');

// ── Token generators ──────────────────────────────────────────────────────────
const generateAccessToken = (user) => jwt.sign(
  { userId: user.id, role: user.role, email: user.email },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
);

const generateRefreshToken = () => crypto.randomBytes(64).toString('hex');

// ── POST /auth/login ──────────────────────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return response.badRequest(res, 'Email and password are required');
    }

    const { rows } = await query(
      'SELECT * FROM users WHERE email = $1 AND status = $2',
      [email.toLowerCase().trim(), 'active']
    );

    if (!rows.length) {
      return response.unauthorized(res, 'Invalid credentials');
    }

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      logger.warn('[Auth] Failed login attempt', { email, ip: req.ip });
      return response.unauthorized(res, 'Invalid credentials');
    }

    // Generate tokens
    const accessToken  = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    const refreshHash  = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Store refresh token hash
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshHash, expiresAt]
    );

    // Update last_login_at
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    logger.info('[Auth] Login successful', { userId: user.id, role: user.role, email: user.email });

    return response.success(res, {
      accessToken,
      refreshToken,
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      user: {
        id:         user.id,
        name:       user.name,
        email:      user.email,
        role:       user.role,
        employeeId: user.employee_id,
      },
    }, 'Login successful');
  } catch (err) {
    next(err);
  }
};

// ── POST /auth/refresh ────────────────────────────────────────────────────────
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) return response.badRequest(res, 'Refresh token required');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await query(
      `SELECT rt.*, u.id as uid, u.email, u.role, u.status, u.name, u.employee_id
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token_hash = $1
         AND rt.expires_at > NOW()
         AND rt.revoked_at IS NULL`,
      [tokenHash]
    );

    if (!rows.length) return response.unauthorized(res, 'Invalid or expired refresh token');
    if (rows[0].status !== 'active') return response.unauthorized(res, 'Account deactivated');

    const user = rows[0];
    const newAccessToken = generateAccessToken({ id: user.uid, role: user.role, email: user.email });

    return response.success(res, { accessToken: newAccessToken }, 'Token refreshed');
  } catch (err) {
    next(err);
  }
};

// ── POST /auth/logout ─────────────────────────────────────────────────────────
const logout = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;
    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
        [tokenHash]
      );
    }
    logger.info('[Auth] Logout', { userId: req.user?.id });
    return response.success(res, null, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
};

// ── GET /auth/me ──────────────────────────────────────────────────────────────
const getProfile = async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, employee_id, name, email, role, phone, status, last_login_at, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return response.notFound(res, 'User not found');
    return response.success(res, rows[0], 'Profile fetched');
  } catch (err) {
    next(err);
  }
};

// ── PATCH /auth/change-password ───────────────────────────────────────────────
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return response.badRequest(res, 'Both current and new password required');
    }
    if (newPassword.length < 8) {
      return response.badRequest(res, 'New password must be at least 8 characters');
    }

    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return response.badRequest(res, 'Current password is incorrect');

    const newHash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);

    // Revoke all refresh tokens
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);

    logger.info('[Auth] Password changed', { userId: req.user.id });
    return response.success(res, null, 'Password updated — please login again');
  } catch (err) {
    next(err);
  }
};

module.exports = { login, refreshToken, logout, getProfile, changePassword };

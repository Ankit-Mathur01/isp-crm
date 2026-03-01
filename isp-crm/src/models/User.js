// src/models/User.js
const BaseModel = require('./BaseModel');
const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

class UserModel extends BaseModel {
  constructor() {
    super('users');
  }

  async findByEmail(email) {
    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    return result.rows[0] || null;
  }

  async create(data) {
    const hash = await bcrypt.hash(data.password, 12);
    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, full_name, phone, role, is_active, created_at`,
      [data.email.toLowerCase(), hash, data.full_name, data.phone || null, data.role || 'agent']
    );
    return result.rows[0];
  }

  async verifyPassword(plaintext, hash) {
    return bcrypt.compare(plaintext, hash);
  }

  generateToken(user) {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
  }

  generateRefreshToken(user) {
    return jwt.sign(
      { userId: user.id, type: 'refresh' },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
    );
  }

  async updateLastLogin(userId) {
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [userId]);
  }

  async getAgents() {
    const result = await query(
      `SELECT id, full_name, email, role FROM users 
       WHERE is_active = true AND role IN ('agent','manager')
       ORDER BY full_name`
    );
    return result.rows;
  }

  safeUser(user) {
    const { password_hash, ...safe } = user;
    return safe;
  }
}

module.exports = new UserModel();

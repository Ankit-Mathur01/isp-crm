// src/controllers/authController.js
const User = require('../models/User');
const { asyncHandler } = require('../middleware/errorHandler');
const Joi = require('joi');

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

const registerSchema = Joi.object({
  email:     Joi.string().email().required(),
  password:  Joi.string().min(8).required(),
  full_name: Joi.string().min(2).max(150).required(),
  phone:     Joi.string().max(30).optional(),
  role:      Joi.string().valid('agent','manager','admin').default('agent'),
});

exports.login = asyncHandler(async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.details[0].message });

  const user = await User.findByEmail(value.email);
  if (!user || !(await User.verifyPassword(value.password, user.password_hash))) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
  if (!user.is_active) {
    return res.status(403).json({ success: false, error: 'Account deactivated' });
  }

  await User.updateLastLogin(user.id);
  const token        = User.generateToken(user);
  const refreshToken = User.generateRefreshToken(user);

  res.json({
    success: true,
    data: {
      user:  User.safeUser(user),
      token,
      refreshToken,
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },
  });
});

exports.register = asyncHandler(async (req, res) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.details[0].message });

  const exists = await User.findByEmail(value.email);
  if (exists) return res.status(409).json({ success: false, error: 'Email already registered' });

  const user  = await User.create(value);
  const token = User.generateToken(user);

  res.status(201).json({ success: true, data: { user, token } });
});

exports.me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id, 'id, email, full_name, phone, role, last_login, created_at');
  res.json({ success: true, data: user });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'Invalid password data' });
  }
  const user = await User.findById(req.user.id);
  if (!(await User.verifyPassword(currentPassword, user.password_hash))) {
    return res.status(401).json({ success: false, error: 'Current password incorrect' });
  }
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(newPassword, 12);
  await User.update(req.user.id, { password_hash: hash });
  res.json({ success: true, message: 'Password updated' });
});

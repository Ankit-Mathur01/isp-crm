// src/middleware/errorHandler.js
const logger = require('../config/logger');

// Wrap async route handlers
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// 404 handler
const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

// Global error handler
const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack:   err.stack,
    url:     req.originalUrl,
    method:  req.method,
    user:    req.user?.id,
  });

  // PostgreSQL specific errors
  if (err.code) {
    const pgErrors = {
      '23505': { status: 409, message: 'Duplicate entry - record already exists' },
      '23503': { status: 400, message: 'Invalid reference - related record not found' },
      '23514': { status: 400, message: 'Data validation failed' },
      '22P02': { status: 400, message: 'Invalid UUID format' },
      '42P01': { status: 500, message: 'Database table not found' },
      '53300': { status: 503, message: 'Database connection pool exhausted' },
    };
    const mapped = pgErrors[err.code];
    if (mapped) {
      return res.status(mapped.status).json({
        success: false,
        error:   mapped.message,
        code:    err.code,
      });
    }
  }

  const status  = err.statusCode || err.status || 500;
  const message = err.expose ? err.message : (status < 500 ? err.message : 'Internal server error');

  res.status(status).json({
    success: false,
    error:   message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

// Validation helper
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    return res.status(400).json({
      success: false,
      error:   'Validation failed',
      details: error.details.map(d => ({ field: d.path.join('.'), message: d.message })),
    });
  }
  req.body = value;
  next();
};

module.exports = { asyncHandler, notFound, errorHandler, validate };

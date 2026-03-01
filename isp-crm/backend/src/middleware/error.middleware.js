/**
 * error.middleware.js
 * Global Express error handler — must be registered LAST in the middleware chain.
 */

const logger   = require('../utils/logger');
const response = require('../utils/response');

const errorHandler = (err, req, res, next) => {
  logger.error('[Error] Unhandled error', {
    message:  err.message,
    stack:    err.stack,
    method:   req.method,
    path:     req.path,
    userId:   req.user?.id,
  });

  // PostgreSQL error codes
  if (err.code) {
    switch (err.code) {
      case '23505': // unique_violation
        return response.conflict(res, `Duplicate value: ${err.detail || 'Resource already exists'}`);
      case '23503': // foreign_key_violation
        return response.badRequest(res, 'Referenced resource does not exist');
      case '23502': // not_null_violation
        return response.badRequest(res, `Required field missing: ${err.column}`);
      case '22P02': // invalid_text_representation (bad UUID etc.)
        return response.badRequest(res, 'Invalid ID format');
      case '42P01': // undefined_table
        return response.error(res, 'Database schema error — run migrations');
      default:
        break;
    }
  }

  // Express-validator errors
  if (err.type === 'validation') {
    return response.badRequest(res, 'Validation failed', err.errors);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError')  return response.unauthorized(res, 'Invalid token');
  if (err.name === 'TokenExpiredError')  return response.unauthorized(res, 'Token expired');

  // Multer file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return response.badRequest(res, `File too large — max ${process.env.MAX_FILE_SIZE_MB || 10}MB`);
  }

  // 404 passthrough
  if (err.status === 404) return response.notFound(res, err.message);

  // Default 500
  const isDev = process.env.NODE_ENV === 'development';
  return response.error(res,
    isDev ? err.message : 'Internal server error',
    500,
    isDev ? { stack: err.stack } : undefined
  );
};

// 404 handler — for unmatched routes
const notFoundHandler = (req, res) => {
  return response.notFound(res, `Route ${req.method} ${req.path} not found`);
};

module.exports = { errorHandler, notFoundHandler };

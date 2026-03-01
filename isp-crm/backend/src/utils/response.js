/**
 * response.js
 * Standardized API response helpers.
 * Every controller uses these to ensure consistent shape.
 */

const success = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
};

const created = (res, data = null, message = 'Created successfully') => {
  return success(res, data, message, 201);
};

const error = (res, message = 'Internal server error', statusCode = 500, errors = null) => {
  const body = {
    success:   false,
    message,
    timestamp: new Date().toISOString(),
  };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
};

const notFound = (res, message = 'Resource not found') => {
  return error(res, message, 404);
};

const badRequest = (res, message = 'Bad request', errors = null) => {
  return error(res, message, 400, errors);
};

const unauthorized = (res, message = 'Unauthorized') => {
  return error(res, message, 401);
};

const forbidden = (res, message = 'Forbidden — insufficient permissions') => {
  return error(res, message, 403);
};

const conflict = (res, message = 'Conflict — resource already exists') => {
  return error(res, message, 409);
};

const paginated = (res, rows, pagination, message = 'Success') => {
  return res.status(200).json({
    success: true,
    message,
    data:    rows,
    pagination,
    timestamp: new Date().toISOString(),
  });
};

module.exports = { success, created, error, notFound, badRequest, unauthorized, forbidden, conflict, paginated };

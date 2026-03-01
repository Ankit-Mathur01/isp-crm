/**
 * audit.middleware.js
 * Automatically logs all mutating API calls (POST/PUT/PATCH/DELETE)
 * to the audit_logs table.
 */

const { query } = require('../config/database');
const logger    = require('../utils/logger');

const AUDITABLE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Map route patterns to entity metadata
const getEntityMeta = (req) => {
  const path = req.path;
  const method = req.method;

  // leads
  if (path.match(/^\/leads\/[^/]+\/feasibility/)) return { entity_type: 'lead', action: 'lead.feasibility_update' };
  if (path.match(/^\/leads\/[^/]+\/installation/)) return { entity_type: 'lead', action: 'lead.installation_update' };
  if (path.match(/^\/leads\/[^/]+\/payment/))      return { entity_type: 'lead', action: 'lead.payment_update' };
  if (path.match(/^\/leads\/[^/]+\/activate/))     return { entity_type: 'lead', action: 'lead.activated' };
  if (path.match(/^\/leads\/[^/]+\/comments/))     return { entity_type: 'lead', action: 'lead.comment_added' };
  if (path.match(/^\/leads\/.+/) && method === 'PATCH')  return { entity_type: 'lead', action: 'lead.updated' };
  if (path.match(/^\/leads\/.+/) && method === 'DELETE') return { entity_type: 'lead', action: 'lead.deleted' };
  if (path === '/leads' && method === 'POST')            return { entity_type: 'lead', action: 'lead.created' };

  // users
  if (path.match(/^\/users\/.+/) && method === 'PATCH')  return { entity_type: 'user', action: 'user.updated' };
  if (path.match(/^\/users\/.+/) && method === 'DELETE') return { entity_type: 'user', action: 'user.deleted' };
  if (path === '/users' && method === 'POST')             return { entity_type: 'user', action: 'user.created' };

  // auth
  if (path === '/auth/login')  return { entity_type: 'auth', action: 'auth.login' };
  if (path === '/auth/logout') return { entity_type: 'auth', action: 'auth.logout' };

  // invoices
  if (path.match(/^\/invoices/)) return { entity_type: 'invoice', action: `invoice.${method.toLowerCase()}` };

  return { entity_type: 'system', action: `${method.toLowerCase()}.${path.replace(/\//g, '_').slice(1)}` };
};

const auditLog = async (req, res, next) => {
  if (!AUDITABLE_METHODS.includes(req.method) || !req.user) {
    return next();
  }

  // Capture original response end to log after response
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    // Only log if response was successful (2xx)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const meta = getEntityMeta(req);
      const entityId =
        req.params.id ||
        req.params.leadId ||
        body?.data?.id ||
        null;

      const logEntry = {
        user_id:     req.user?.id || null,
        user_role:   req.user?.role || null,
        action:      meta.action,
        entity_type: meta.entity_type,
        entity_id:   entityId,
        new_values:  JSON.stringify(req.body || {}),
        old_values:  JSON.stringify({}),
        ip_address:  req.ip || req.connection?.remoteAddress,
        user_agent:  req.headers['user-agent'] || null,
      };

      // Fire-and-forget — don't block response
      query(
        `INSERT INTO audit_logs
          (user_id, user_role, action, entity_type, entity_id, new_values, old_values, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5::uuid,$6,$7,$8,$9)`,
        [
          logEntry.user_id, logEntry.user_role, logEntry.action,
          logEntry.entity_type,
          logEntry.entity_id,
          logEntry.new_values, logEntry.old_values,
          logEntry.ip_address, logEntry.user_agent,
        ]
      ).catch((err) => logger.error('[Audit] Failed to write audit log', { error: err.message }));
    }

    return originalJson(body);
  };

  next();
};

module.exports = { auditLog };

/**
 * database.js
 * PostgreSQL connection pool configuration using pg-pool.
 * All DB access in the app goes through this single pool instance.
 */

const { Pool } = require('pg');
const logger   = require('../utils/logger');

// ── Build connection config from environment ──────────────────────────────────
const poolConfig = {
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '5432', 10),
  database:           process.env.DB_NAME     || 'isp_crm',
  user:               process.env.DB_USER     || 'postgres',
  password:           process.env.DB_PASSWORD || '',
  max:                parseInt(process.env.DB_POOL_MAX              || '20',   10),
  min:                parseInt(process.env.DB_POOL_MIN              || '2',    10),
  idleTimeoutMillis:  parseInt(process.env.DB_POOL_IDLE_TIMEOUT     || '30000',10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '2000', 10),
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }   // set rejectUnauthorized: true + cert in production
    : false,
};

// ── Create pool ───────────────────────────────────────────────────────────────
const pool = new Pool(poolConfig);

// ── Pool event listeners ──────────────────────────────────────────────────────
pool.on('connect', (client) => {
  logger.debug(`[DB] New client connected — total: ${pool.totalCount}, idle: ${pool.idleCount}`);
  // Enforce UTC for every session
  client.query("SET timezone = 'UTC'");
});

pool.on('acquire', () => {
  logger.debug(`[DB] Client acquired — waiting: ${pool.waitingCount}`);
});

pool.on('remove', () => {
  logger.debug('[DB] Client removed from pool');
});

pool.on('error', (err, client) => {
  logger.error('[DB] Unexpected error on idle client', { error: err.message, stack: err.stack });
  // Do NOT exit — the pool will recover
});

// ── Health-check helper ───────────────────────────────────────────────────────
const checkConnection = async () => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT NOW() AS now, version() AS version');
    logger.info('[DB] PostgreSQL connected successfully', {
      serverTime: result.rows[0].now,
      version:    result.rows[0].version.split(' ').slice(0, 2).join(' '),
      host:       poolConfig.host,
      port:       poolConfig.port,
      database:   poolConfig.database,
    });
    return true;
  } catch (err) {
    logger.error('[DB] Connection check failed', { error: err.message });
    return false;
  } finally {
    if (client) client.release();
  }
};

// ── Transaction helper ────────────────────────────────────────────────────────
/**
 * Runs `fn(client)` inside a BEGIN/COMMIT transaction.
 * Automatically rolls back on error and releases the client.
 *
 * Usage:
 *   const result = await withTransaction(async (client) => {
 *     await client.query('INSERT ...');
 *     return await client.query('SELECT ...');
 *   });
 */
const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[DB] Transaction rolled back', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
};

// ── Paginated query helper ────────────────────────────────────────────────────
/**
 * Wraps a SELECT query with LIMIT / OFFSET and returns
 * { rows, pagination: { total, page, limit, totalPages } }
 */
const paginatedQuery = async (baseQuery, params = [], page = 1, limit = 20) => {
  const offset = (page - 1) * limit;

  // Count query — strip ORDER BY for performance
  const countQuery = `SELECT COUNT(*) AS total FROM (${baseQuery}) AS _count_subq`;
  const countResult = await pool.query(countQuery, params);
  const total = parseInt(countResult.rows[0].total, 10);

  // Data query
  const dataQuery = `${baseQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const dataResult = await pool.query(dataQuery, [...params, limit, offset]);

  return {
    rows: dataResult.rows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// ── Pool stats (for monitoring endpoint) ─────────────────────────────────────
const getPoolStats = () => ({
  total:   pool.totalCount,
  idle:    pool.idleCount,
  waiting: pool.waitingCount,
});

module.exports = {
  pool,
  query:           (text, params) => pool.query(text, params),
  checkConnection,
  withTransaction,
  paginatedQuery,
  getPoolStats,
};

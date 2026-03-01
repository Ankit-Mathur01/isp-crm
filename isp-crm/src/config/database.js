// src/config/database.js
// PostgreSQL connection pool configuration

const { Pool } = require('pg');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [new winston.transports.Console()]
});

// ─────────────────────────────────────────
// Pool Configuration
// ─────────────────────────────────────────
const poolConfig = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'isp_crm',
  user:     process.env.DB_USER     || 'crm_user',
  password: process.env.DB_PASSWORD || '',
  
  // Pool settings
  min:              parseInt(process.env.DB_POOL_MIN)     || 2,
  max:              parseInt(process.env.DB_POOL_MAX)     || 20,
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE)  || 10000,
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
  
  // SSL for production
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false,

  // Statement timeout: 30 seconds per query
  statement_timeout: 30000,
  
  // Application name (visible in pg_stat_activity)
  application_name: 'isp_crm_v2',
};

const pool = new Pool(poolConfig);

// ─────────────────────────────────────────
// Pool Event Handlers
// ─────────────────────────────────────────
pool.on('connect', (client) => {
  logger.debug('New DB client connected');
  // Set timezone for every connection
  client.query("SET timezone = 'UTC'");
  // Enforce search path
  client.query('SET search_path TO public');
});

pool.on('error', (err, client) => {
  logger.error('Unexpected DB pool error:', { message: err.message });
});

pool.on('remove', () => {
  logger.debug('DB client removed from pool');
});

// ─────────────────────────────────────────
// Query Helpers
// ─────────────────────────────────────────

/**
 * Execute a single query
 * @param {string} text  - SQL string
 * @param {Array}  params - Parameterized values
 * @returns {Promise<pg.QueryResult>}
 */
const query = async (text, params = []) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (duration > 1000) {
      logger.warn('Slow query detected', { duration, query: text });
    } else {
      logger.debug('Query executed', { duration, rows: result.rowCount });
    }
    
    return result;
  } catch (error) {
    logger.error('Query error', {
      message: error.message,
      code:    error.code,
      query:   text,
    });
    throw error;
  }
};

/**
 * Get a dedicated client for transactions
 */
const getClient = async () => {
  const client = await pool.connect();
  
  // Wrap query to log transaction queries
  const originalQuery = client.query.bind(client);
  client.query = async (text, params) => {
    const start = Date.now();
    try {
      const result = await originalQuery(text, params);
      logger.debug('TX query', { duration: Date.now() - start });
      return result;
    } catch (err) {
      logger.error('TX query error', { message: err.message });
      throw err;
    }
  };
  
  return client;
};

/**
 * Execute queries inside a transaction.
 * Automatically commits or rolls back.
 * 
 * @param {Function} callback - async (client) => { ... }
 */
const withTransaction = async (callback) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back', { message: error.message });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Build a parameterized INSERT query
 * @param {string} table  - Table name
 * @param {Object} data   - { column: value }
 * @returns {{ text, values }}
 */
const buildInsert = (table, data) => {
  const keys   = Object.keys(data);
  const values = Object.values(data);
  const cols   = keys.join(', ');
  const params = keys.map((_, i) => `$${i + 1}`).join(', ');
  
  return {
    text:   `INSERT INTO ${table} (${cols}) VALUES (${params}) RETURNING *`,
    values,
  };
};

/**
 * Build a parameterized UPDATE query
 * @param {string} table     - Table name
 * @param {Object} data      - Columns to update
 * @param {Object} where     - WHERE conditions
 * @returns {{ text, values }}
 */
const buildUpdate = (table, data, where) => {
  const dataKeys   = Object.keys(data);
  const whereKeys  = Object.keys(where);
  const values     = [...Object.values(data), ...Object.values(where)];
  
  const set        = dataKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const conditions = whereKeys.map((k, i) => `${k} = $${dataKeys.length + i + 1}`).join(' AND ');
  
  return {
    text:   `UPDATE ${table} SET ${set}, updated_at = NOW() WHERE ${conditions} RETURNING *`,
    values,
  };
};

/**
 * Paginate helper - returns LIMIT/OFFSET clause
 * @param {number} page     - 1-based page
 * @param {number} pageSize - rows per page (default 20, max 100)
 */
const paginate = (page = 1, pageSize = 20) => {
  const limit  = Math.min(Math.max(parseInt(pageSize) || 20, 1), 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  return { limit, offset };
};

/**
 * Health check - test pool connectivity
 */
const healthCheck = async () => {
  try {
    const result = await query('SELECT NOW() AS time, version() AS pg_version');
    return {
      status: 'healthy',
      timestamp: result.rows[0].time,
      version: result.rows[0].pg_version,
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
    };
  } catch (err) {
    return { status: 'unhealthy', error: err.message };
  }
};

module.exports = {
  pool,
  query,
  getClient,
  withTransaction,
  buildInsert,
  buildUpdate,
  paginate,
  healthCheck,
};

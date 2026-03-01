/**
 * server.js
 * Express application entry point.
 * Wires up all middleware, routes, and starts the server.
 */

require('dotenv').config();

const express       = require('express');
const helmet        = require('helmet');
const cors          = require('cors');
const compression   = require('compression');
const morgan        = require('morgan');
const rateLimit     = require('express-rate-limit');
const path          = require('path');

const logger                          = require('./utils/logger');
const { checkConnection }             = require('./config/database');
const routes                          = require('./routes/index.routes');
const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');

// ── App init ──────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;
const API  = process.env.API_PREFIX || '/api/v1';

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,           // Adjust if serving frontend
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin:      process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Request-ID'],
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs:       parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  max:            parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  standardHeaders: true,
  legacyHeaders:  false,
  message:        { success: false, message: 'Too many requests — please try again later' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max:      20,               // max 20 login attempts per window
  message:  { success: false, message: 'Too many login attempts — please wait 15 minutes' },
});

app.use(`${API}/auth/login`, authLimiter);
app.use(API, globalLimiter);

// ── Request parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// ── HTTP request logging ──────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip:   (req) => req.path === `${API}/health`,   // don't log health checks
  }));
}

// ── Static file serving (uploaded documents) ──────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
app.use('/uploads', express.static(UPLOAD_DIR));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use(API, routes);

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    app:        'ISP CRM API',
    company:    process.env.COMPANY_NAME || 'ReliableSoft Technologies',
    version:    '1.0.0',
    apiDocs:    `${API}/health`,
    environment: process.env.NODE_ENV,
  });
});

// ── 404 & Error handlers ──────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const gracefulShutdown = (signal) => {
  logger.info(`[Server] ${signal} received — shutting down gracefully...`);
  server.close(() => {
    logger.info('[Server] HTTP server closed');
    require('./config/database').pool.end(() => {
      logger.info('[DB] Pool drained — exiting');
      process.exit(0);
    });
  });
  // Force exit after 10s if graceful shutdown hangs
  setTimeout(() => { logger.error('[Server] Forced shutdown'); process.exit(1); }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('uncaughtException',  (err) => { logger.error('[Server] Uncaught exception',  { error: err.message, stack: err.stack }); });
process.on('unhandledRejection', (err) => { logger.error('[Server] Unhandled rejection', { error: err?.message }); });

// ── Start ─────────────────────────────────────────────────────────────────────
let server;

const start = async () => {
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`  ISP CRM API — ${process.env.COMPANY_NAME}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Verify DB connectivity before accepting requests
  const dbOk = await checkConnection();
  if (!dbOk) {
    logger.error('[Server] Cannot connect to PostgreSQL — aborting startup');
    process.exit(1);
  }

  server = app.listen(PORT, () => {
    logger.info(`[Server] Listening on http://localhost:${PORT}`);
    logger.info(`[Server] API prefix: ${API}`);
    logger.info(`[Server] Environment: ${process.env.NODE_ENV}`);
    logger.info(`[Server] Health check: http://localhost:${PORT}${API}/health`);
  });
};

start();

module.exports = app; // Export for tests

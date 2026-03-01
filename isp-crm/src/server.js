// src/server.js
// ISP CRM v2 — Main Entry Point
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const compression = require('compression');
const rateLimit  = require('express-rate-limit');

const logger     = require('./config/logger');
const { pool }   = require('./config/database');
const { loadFlags } = require('./config/features');
const routes     = require('./routes/index');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const cron       = require('./services/cronService');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────
// Security & Core Middleware
// ─────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods:     ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(compression());
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip:   (req) => req.url === '/health',
}));

// Raw body for Stripe webhooks (must be before json middleware)
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res, next) => {
  req.rawBody = req.body;
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use('/api', rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX)        || 100,
  message:  { success: false, error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: (req) => req.url.includes('/health'),
}));

// Stricter rate limit for auth
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' },
}));

// ─────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────
app.use('/api', routes);

// Root info
app.get('/', (req, res) => {
  res.json({
    name:    'ISP CRM API',
    version: 'v2.0.0',
    status:  'running',
    docs:    '/api/health',
  });
});

// ─────────────────────────────────────────
// Error Handlers
// ─────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─────────────────────────────────────────
// Server Bootstrap
// ─────────────────────────────────────────
const bootstrap = async () => {
  // Test DB connection
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version()');
    client.release();
    logger.info('✅ PostgreSQL connected: ' + result.rows[0].version.split(' ').slice(0,2).join(' '));
  } catch (err) {
    logger.error('❌ PostgreSQL connection failed:', { message: err.message });
    logger.error('   Make sure PostgreSQL is running and .env is configured correctly');
    process.exit(1);
  }

  // Load feature flags
  await loadFlags();
  logger.info('✅ Feature flags loaded');

  // Start cron jobs
  cron.startAll();
  logger.info('✅ Cron jobs started');

  // Start server
  const server = app.listen(PORT, () => {
    logger.info(`🚀 ISP CRM v2 running on port ${PORT}`);
    logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`   API Base:    http://localhost:${PORT}/api`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully...`);
    server.close(async () => {
      cron.stopAll();
      await pool.end();
      logger.info('Server closed. Goodbye!');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000); // force after 10s
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', { reason: String(reason) });
  });
};

bootstrap();

module.exports = app; // for tests

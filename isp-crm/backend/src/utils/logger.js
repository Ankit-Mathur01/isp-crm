/**
 * logger.js
 * Centralized Winston logger with daily log rotation.
 * Outputs structured JSON to files and colorized text to console.
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs   = require('fs');

const LOG_DIR   = process.env.LOG_DIR  || './logs';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ── Custom format ─────────────────────────────────────────────────────────────
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  }),
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// ── Transports ────────────────────────────────────────────────────────────────
const transports = [
  // Console (dev only)
  new winston.transports.Console({
    level: LOG_LEVEL,
    format: consoleFormat,
    silent: process.env.NODE_ENV === 'test',
  }),

  // All logs — daily rotation, kept 14 days
  new DailyRotateFile({
    filename:      path.join(LOG_DIR, 'app-%DATE%.log'),
    datePattern:   'YYYY-MM-DD',
    zippedArchive: true,
    maxSize:       '20m',
    maxFiles:      '14d',
    level:         LOG_LEVEL,
    format:        fileFormat,
  }),

  // Error logs — kept 30 days
  new DailyRotateFile({
    filename:      path.join(LOG_DIR, 'error-%DATE%.log'),
    datePattern:   'YYYY-MM-DD',
    zippedArchive: true,
    maxSize:       '20m',
    maxFiles:      '30d',
    level:         'error',
    format:        fileFormat,
  }),
];

const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: 'isp-crm-api' },
  transports,
  exceptionHandlers: [
    new DailyRotateFile({
      filename:    path.join(LOG_DIR, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles:    '30d',
    }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename:    path.join(LOG_DIR, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles:    '30d',
    }),
  ],
});

module.exports = logger;

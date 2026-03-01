// src/services/cronService.js
const cron  = require('node-cron');
const { query } = require('../config/database');
const logger = require('../config/logger');

/**
 * Send follow-up reminders (runs every 15 minutes)
 */
const followupReminders = cron.schedule('*/15 * * * *', async () => {
  logger.info('[CRON] Checking follow-up reminders...');
  try {
    const result = await query(
      `SELECT f.id, f.lead_id, f.type, f.scheduled_at,
              l.full_name AS lead_name, l.phone,
              u.email AS agent_email, u.full_name AS agent_name
       FROM v2_followups f
       JOIN leads l ON l.id = f.lead_id
       JOIN users u ON u.id = f.assigned_to
       WHERE f.status = 'pending'
         AND f.reminder_sent = false
         AND f.scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '30 minutes'`
    );

    for (const followup of result.rows) {
      // Mark as reminded first (prevent double-send)
      await query('UPDATE v2_followups SET reminder_sent=true WHERE id=$1', [followup.id]);
      
      // Send email notification (if email service configured)
      try {
        const emailService = require('./emailService');
        await emailService.sendFollowupReminder(followup);
        logger.info(`[CRON] Reminder sent for follow-up ${followup.id}`);
      } catch (emailErr) {
        logger.warn(`[CRON] Email failed for ${followup.id}: ${emailErr.message}`);
      }
    }

    if (result.rows.length) {
      logger.info(`[CRON] Processed ${result.rows.length} follow-up reminders`);
    }
  } catch (err) {
    logger.error('[CRON] followupReminders error:', { message: err.message });
  }
}, { scheduled: false });

/**
 * Refresh materialized view for reports (runs every hour)
 */
const refreshReportViews = cron.schedule('0 * * * *', async () => {
  logger.info('[CRON] Refreshing report materialized views...');
  try {
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_agent_conversion');
    logger.info('[CRON] mv_agent_conversion refreshed');
  } catch (err) {
    logger.warn('[CRON] Materialized view refresh failed:', { message: err.message });
  }
}, { scheduled: false });

/**
 * Auto-score leads based on activity (daily at 1am)
 */
const autoScoreLeads = cron.schedule('0 1 * * *', async () => {
  logger.info('[CRON] Auto-scoring leads...');
  try {
    // Score based on recent activity, status, and days since creation
    await query(`
      UPDATE leads SET score = LEAST(100, GREATEST(0,
        CASE status
          WHEN 'won'         THEN 100
          WHEN 'negotiation' THEN 80
          WHEN 'proposal'    THEN 60
          WHEN 'qualified'   THEN 40
          WHEN 'contacted'   THEN 20
          WHEN 'lost'        THEN 0
          ELSE 10
        END
        -- Boost for recent calls
        + COALESCE((
          SELECT LEAST(20, COUNT(*) * 5)
          FROM v2_calls c
          WHERE c.lead_id = leads.id
            AND c.called_at >= NOW() - INTERVAL '7 days'
        ), 0)
        -- Boost for expected value
        + CASE WHEN expected_value > 500 THEN 10
               WHEN expected_value > 200 THEN 5
               ELSE 0 END
      ))
      WHERE status NOT IN ('won', 'lost')
    `);
    logger.info('[CRON] Lead auto-scoring complete');
  } catch (err) {
    logger.error('[CRON] autoScoreLeads error:', { message: err.message });
  }
}, { scheduled: false });

/**
 * Clean up old webhook events (weekly)
 */
const cleanupWebhooks = cron.schedule('0 2 * * 0', async () => {
  try {
    const result = await query(
      `DELETE FROM v2_webhook_events 
       WHERE processed = true AND created_at < NOW() - INTERVAL '90 days'`
    );
    logger.info(`[CRON] Cleaned ${result.rowCount} old webhook events`);
  } catch (err) {
    logger.error('[CRON] cleanupWebhooks error:', { message: err.message });
  }
}, { scheduled: false });

const startAll = () => {
  followupReminders.start();
  refreshReportViews.start();
  autoScoreLeads.start();
  cleanupWebhooks.start();
  logger.info('[CRON] All scheduled jobs started');
};

const stopAll = () => {
  followupReminders.stop();
  refreshReportViews.stop();
  autoScoreLeads.stop();
  cleanupWebhooks.stop();
};

module.exports = { startAll, stopAll };

// src/services/emailService.js
const nodemailer = require('nodemailer');
const logger = require('../config/logger');

let transporter;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

const send = async ({ to, subject, html, text }) => {
  if (!process.env.SMTP_USER) {
    logger.warn('[EMAIL] SMTP not configured, skipping email');
    return;
  }
  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || 'ISP CRM <noreply@example.com>',
      to, subject, html, text,
    });
    logger.info(`[EMAIL] Sent "${subject}" to ${to}`);
  } catch (err) {
    logger.error(`[EMAIL] Failed to send to ${to}:`, { message: err.message });
    throw err;
  }
};

const sendFollowupReminder = async (followup) => {
  await send({
    to:      followup.agent_email,
    subject: `Reminder: ${followup.type} with ${followup.lead_name}`,
    html: `
      <h2>Follow-up Reminder</h2>
      <p>Hi ${followup.agent_name},</p>
      <p>You have a scheduled <strong>${followup.type}</strong> with:</p>
      <ul>
        <li><strong>Lead:</strong> ${followup.lead_name}</li>
        <li><strong>Phone:</strong> ${followup.phone}</li>
        <li><strong>Scheduled:</strong> ${new Date(followup.scheduled_at).toLocaleString()}</li>
      </ul>
      <p>Log in to ISP CRM to view details.</p>
    `,
  });
};

const sendWelcome = async (user) => {
  await send({
    to:      user.email,
    subject: 'Welcome to ISP CRM',
    html: `<h2>Welcome, ${user.full_name}!</h2><p>Your account has been created. Please log in to get started.</p>`,
  });
};

module.exports = { send, sendFollowupReminder, sendWelcome };

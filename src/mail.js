// Sends the password-reset code. SMTP (e.g. Gmail with an app password) when configured; otherwise the code is
// printed to the server console so you can test without email.
const config = require('./config');

const sent = []; // last messages, for tests and the console driver

let transporter = null;
if (config.mailDriver === 'smtp') {
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

async function sendResetCode(to, name, code) {
  const subject = 'Your FaceGuard password reset code';
  const text =
    `Hi ${name},\n\nYour FaceGuard password reset code is: ${code}\n\n` +
    `It expires in ${config.otpMinutes} minutes. If you didn't ask for this, you can ignore this email.\n`;
  const html =
    `<p>Hi ${escapeHtml(name)},</p><p>Your FaceGuard password reset code is:</p>` +
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>` +
    `<p>It expires in ${config.otpMinutes} minutes. If you didn't ask for this, you can ignore this email.</p>`;

  sent.push({ to, subject, code });
  if (sent.length > 20) sent.shift();

  if (transporter) await transporter.sendMail({ from: config.smtp.from, to, subject, text, html });
  else if (process.env.NODE_ENV !== 'test') console.log(`[mail:console] reset code for ${to}: ${code}`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { sendResetCode, sent };

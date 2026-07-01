const nodemailer = require('nodemailer');

function getGmailPassword() {
  return (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
}

function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = getGmailPassword();

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 15000,
    tls: { rejectUnauthorized: true }
  });
}

let transporter = createTransporter();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(email, otp, type = 'signup') {
  if (!transporter) {
    transporter = createTransporter();
  }
  if (!transporter) {
    throw new Error('Email not configured on server (GMAIL_USER / GMAIL_APP_PASSWORD)');
  }

  const subject = type === 'signup'
    ? 'HexaChat - Verify Your Email'
    : 'HexaChat - Reset Your Password';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#000;color:#fff;border-radius:16px;">
      <h1 style="margin:0 0 8px;font-size:28px;font-weight:900;">HexaChat</h1>
      <p style="color:#aaa;margin:0 0 24px;">${type === 'signup' ? 'Verify your email to get started' : 'Reset your password'}</p>
      <div style="background:#111;border:2px solid #fff;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
        <p style="color:#888;margin:0 0 8px;font-size:14px;">Your OTP Code</p>
        <h2 style="margin:0;font-size:36px;letter-spacing:8px;font-weight:900;">${otp}</h2>
      </div>
      <p style="color:#666;font-size:13px;">This code expires in 10 minutes. Do not share it with anyone.</p>
    </div>
  `;

  await transporter.sendMail({
    from: `"HexaChat" <${process.env.GMAIL_USER}>`,
    to: email,
    subject,
    html
  });
}

/** Send email with timeout — never blocks longer than ms */
async function sendOTPEmailWithTimeout(email, otp, type = 'signup', ms = 12000) {
  return Promise.race([
    sendOTPEmail(email, otp, type),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Email server timeout')), ms);
    })
  ]);
}

/** Fire-and-forget background send (logs errors only) */
function sendOTPEmailBackground(email, otp, type = 'signup') {
  sendOTPEmailWithTimeout(email, otp, type, 20000).catch(err => {
    console.error('Background OTP email failed:', err.message);
  });
}

module.exports = {
  generateOTP,
  sendOTPEmail,
  sendOTPEmailWithTimeout,
  sendOTPEmailBackground
};

const nodemailer = require('nodemailer');

function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');

  if (!user || !pass) {
    throw new Error('GMAIL_USER or GMAIL_APP_PASSWORD missing in environment');
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user, pass },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2' }
  });
}

const transporter = createTransporter();

async function verifyEmailConfig() {
  await createTransporter().verify();
}

async function sendOTP(email, otp, purpose) {
  const subject = purpose === 'signup'
    ? 'HexaChat - Verify Your Email'
    : 'HexaChat - Reset Your Password';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#000;color:#fff;border-radius:16px;">
      <h1 style="color:#fff;margin:0 0 8px;font-size:28px;font-weight:900;">HexaChat</h1>
      <p style="color:#aaa;margin:0 0 24px;">${purpose === 'signup' ? 'Welcome! Verify your email to get started.' : 'Reset your password with the code below.'}</p>
      <div style="background:#111;border:2px solid #fff;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
        <p style="color:#888;margin:0 0 8px;font-size:14px;">Your OTP Code</p>
        <h2 style="color:#fff;margin:0;font-size:36px;letter-spacing:8px;font-weight:900;">${otp}</h2>
      </div>
      <p style="color:#666;font-size:13px;">This code expires in 10 minutes. Do not share it with anyone.</p>
    </div>
  `;

  const info = await createTransporter().sendMail({
    from: `"HexaChat" <${process.env.GMAIL_USER}>`,
    to: email,
    subject,
    html,
    text: `Your HexaChat OTP is: ${otp}. It expires in 10 minutes.`
  });

  console.log('Email sent:', info.messageId);
  return info;
}

async function sendOTPWithTimeout(email, otp, purpose, ms = 30000) {
  return Promise.race([
    sendOTP(email, otp, purpose),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Email delivery timed out after 30s')), ms)
    )
  ]);
}

module.exports = { sendOTP, sendOTPWithTimeout, verifyEmailConfig };

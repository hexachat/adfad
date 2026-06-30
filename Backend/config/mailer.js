const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS.replace(/\s/g, '')
  }
});

async function sendOTP(email, otp, purpose = 'verification') {
  const subject =
    purpose === 'forgot'
      ? 'HexaChat - Password Reset OTP'
      : 'HexaChat - Email Verification OTP';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#000;color:#fff;border-radius:16px;">
      <h1 style="margin:0 0 8px;font-size:28px;font-weight:900;">HexaChat</h1>
      <p style="color:#aaa;margin:0 0 24px;">Your ${purpose === 'forgot' ? 'password reset' : 'verification'} code</p>
      <div style="background:#fff;color:#000;font-size:36px;font-weight:900;letter-spacing:8px;text-align:center;padding:20px;border-radius:12px;">${otp}</div>
      <p style="color:#888;margin-top:24px;font-size:13px;">This code expires in 10 minutes. Do not share it with anyone.</p>
    </div>
  `;

  await transporter.sendMail({
    from: `"HexaChat" <${process.env.GMAIL_USER}>`,
    to: email,
    subject,
    html
  });
}

module.exports = { sendOTP };

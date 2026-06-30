const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(email, otp, type = 'signup') {
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

module.exports = { generateOTP, sendOTPEmail };

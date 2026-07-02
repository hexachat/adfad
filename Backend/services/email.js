const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

async function sendOTP(email, otp, purpose) {
  const subject = purpose === 'signup'
    ? 'HexaChat - Verify Your Email'
    : 'HexaChat - Reset Your Password';

  const html = `
    <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0a0a0a;color:#fff;border-radius:16px;">
      <h1 style="color:#0066FF;margin:0 0 8px;font-size:28px;font-weight:800;">HexaChat</h1>
      <p style="color:#aaa;margin:0 0 24px;">${purpose === 'signup' ? 'Verify your account' : 'Reset your password'}</p>
      <div style="background:#111;border:2px solid #0066FF;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
        <p style="color:#888;margin:0 0 8px;font-size:14px;">Your OTP Code</p>
        <h2 style="color:#0066FF;font-size:36px;letter-spacing:8px;margin:0;font-weight:900;">${otp}</h2>
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

module.exports = { sendOTP };

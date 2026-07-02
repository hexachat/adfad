const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

async function sendOTP(email, code, type) {
  const subject = type === 'signup'
    ? 'HexaChat - Verify Your Email'
    : 'HexaChat - Reset Your Password';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#000;color:#fff;border-radius:16px;">
      <h1 style="color:#fff;font-weight:900;margin-bottom:8px;">HexaChat</h1>
      <p style="color:#aaa;">Your verification code is:</p>
      <div style="font-size:36px;font-weight:900;letter-spacing:8px;padding:20px;background:#111;border-radius:12px;text-align:center;margin:20px 0;">${code}</div>
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

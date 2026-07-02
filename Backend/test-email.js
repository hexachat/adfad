require('dotenv').config();
const { sendOTP, verifyEmailConfig } = require('./config/nodemailer');

async function main() {
  const email = process.argv[2] || 'knowledgeislamic8@gmail.com';
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  console.log('Verifying Gmail config...');
  await verifyEmailConfig();
  console.log('Gmail OK. Sending demo OTP to', email);

  await sendOTP(email, otp, 'signup');
  console.log('Demo OTP sent successfully:', otp);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});

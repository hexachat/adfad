require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const supabase = require('../config/supabase');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.log('Usage: node scripts/get-otp.js email@example.com');
    return;
  }
  const { data } = await supabase
    .from('otp_codes')
    .select('otp, expires_at, used')
    .eq('email', email.toLowerCase())
    .eq('type', 'signup')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  console.log(data || 'No OTP found');
}

main();

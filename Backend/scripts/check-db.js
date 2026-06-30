require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const tables = ['users', 'otp_codes', 'otps', 'contacts', 'messages'];
  for (const table of tables) {
    const { error } = await supabase.from(table).select('id').limit(1);
    console.log(table + ':', error ? error.message : 'OK');
  }
}

main();

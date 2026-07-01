const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { generateOTP, sendOTPEmailWithTimeout, sendOTPEmailBackground } = require('../config/mailer');
const { generateToken } = require('../middleware/auth');

const router = require('express').Router();

async function findUserByEmail(email) {
  const { data } = await supabase
    .from('users')
    .select('id, email_verified')
    .eq('email', email)
    .maybeSingle();
  return data;
}

async function findUserByPhone(phone_number) {
  const { data } = await supabase
    .from('users')
    .select('id, email_verified')
    .eq('phone_number', phone_number)
    .maybeSingle();
  return data;
}

// Signup — save account + OTP, respond instantly, email in background
router.post('/signup', async (req, res) => {
  try {
    const name = (req.body.name || req.body.fullName || req.body.username || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || req.body.pass;
    const phone_number = String(req.body.phone_number || req.body.phone || req.body.number || '').trim();

    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (!password) return res.status(400).json({ error: 'Password is required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!phone_number) return res.status(400).json({ error: 'Phone number is required' });

    const [existingEmail, existingPhone] = await Promise.all([
      findUserByEmail(email),
      findUserByPhone(phone_number)
    ]);

    if (existingEmail?.email_verified) {
      return res.status(400).json({ error: 'Email already registered. Please login.' });
    }
    if (existingPhone?.email_verified) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    // Unverified account retry — update instead of fail
    if (existingEmail && !existingEmail.email_verified) {
      await supabase.from('users').delete().eq('email', email);
    }
    if (existingPhone && !existingPhone.email_verified) {
      await supabase.from('users').delete().eq('phone_number', phone_number);
    }

    const password_hash = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otp_codes').delete().eq('email', email).eq('type', 'signup');

    const { error: otpError } = await supabase.from('otp_codes').insert({
      email, otp, type: 'signup', expires_at, used: false
    });
    if (otpError) {
      console.error('OTP insert error:', otpError);
      return res.status(500).json({ error: 'Could not save OTP. Run supabase_schema.sql in Supabase.' });
    }

    const { error: insertError } = await supabase.from('users').insert({
      name, email, password_hash, phone_number, email_verified: false
    });

    if (insertError) {
      console.error('User insert error:', insertError);
      if (insertError.code === '23505') {
        // Account exists but unverified — let user continue to OTP
        return res.json({
          success: true,
          message: 'Account exists — enter OTP to verify',
          email,
          phone_number,
          phone: phone_number,
          alreadyExists: true
        });
      }
      return res.status(500).json({ error: insertError.message || 'Failed to create account' });
    }

    // ✅ Respond immediately — do NOT wait for email
    res.json({
      success: true,
      message: 'Account created',
      email,
      phone_number,
      phone: phone_number
    });

    // Send OTP email after response (never blocks signup)
    setImmediate(() => {
      sendOTPEmailBackground(email, otp, 'signup');
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

// Verify OTP (signup)
router.post('/verify-otp', async (req, res) => {
  try {
    const { email: rawEmail, otp } = req.body;
    const email = (rawEmail || '').trim().toLowerCase();
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

    const { data: otpRecord } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email)
      .eq('type', 'signup')
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRecord) return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP expired. Please resend.' });
    }
    if (String(otpRecord.otp).trim() !== String(otp).trim()) {
      return res.status(400).json({ error: 'OTP incorrect' });
    }

    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);
    await supabase.from('users').update({ email_verified: true }).eq('email', email);

    const { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    if (!user) return res.status(400).json({ error: 'Account not found. Sign up again.' });

    const token = generateToken(user);

    res.json({
      message: 'Email verified successfully',
      token,
      user: {
        id: user.id, name: user.name, email: user.email,
        phone_number: user.phone_number, profile_photo: user.profile_photo
      }
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Resend OTP
router.post('/resend-otp', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const type = req.body.type || 'signup';
    if (!email) return res.status(400).json({ error: 'Email required' });

    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otp_codes').delete().eq('email', email).eq('type', type);
    await supabase.from('otp_codes').insert({ email, otp, type, expires_at, used: false });

    let emailSent = false;
    sendOTPEmailBackground(email, otp, type);
    emailSent = true;

    res.json({
      message: 'OTP sent — check your email (and spam folder)',
      emailSent: true
    });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data: user, error: dbError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (dbError) {
      console.error('Login db error:', dbError);
      return res.status(500).json({ error: 'Database error. Check Supabase connection.' });
    }
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.email_verified) return res.status(401).json({ error: 'Please verify your email first. Check OTP page.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = generateToken(user);
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id, name: user.name, email: user.email,
        phone_number: user.phone_number, profile_photo: user.profile_photo
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Forgot password - send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email required' });

    const { data: user } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (!user) return res.status(404).json({ error: 'No account found with this email' });

    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otp_codes').delete().eq('email', email).eq('type', 'forgot_password');
    await supabase.from('otp_codes').insert({
      email, otp, type: 'forgot_password', expires_at, used: false
    });

    try {
      await sendOTPEmailWithTimeout(email, otp, 'forgot_password', 10000);
    } catch {
      sendOTPEmailBackground(email, otp, 'forgot_password');
    }

    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to send reset OTP' });
  }
});

// Verify forgot password OTP
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

    const { data: otpRecord } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email)
      .eq('type', 'forgot_password')
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRecord) return res.status(400).json({ error: 'No OTP found' });
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP expired' });
    }
    if (String(otpRecord.otp).trim() !== String(otp).trim()) {
      return res.status(400).json({ error: 'OTP incorrect' });
    }

    res.json({ message: 'OTP verified', resetToken: otpRecord.id });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, new_password } = req.body;
    if (!email || !otp || !new_password) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const { data: otpRecord } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email)
      .eq('type', 'forgot_password')
      .eq('otp', otp)
      .eq('used', false)
      .maybeSingle();

    if (!otpRecord) return res.status(400).json({ error: 'Invalid OTP' });
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP expired' });
    }

    const password_hash = await bcrypt.hash(new_password, 10);
    await supabase.from('users').update({ password_hash }).eq('email', email);
    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

module.exports = router;

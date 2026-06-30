const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { generateOTP, sendOTPEmail } = require('../config/mailer');
const { generateToken } = require('../middleware/auth');

const router = require('express').Router();

// Signup - send OTP
router.post('/signup', async (req, res) => {
  try {
    const name = (req.body.name || req.body.fullName || req.body.username || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || req.body.pass;
    const phone_number = String(req.body.phone_number || req.body.phone || req.body.number || '').trim();

    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (!password) return res.status(400).json({ error: 'Password is required' });
    if (!phone_number) return res.status(400).json({ error: 'Phone number is required' });

    const { data: existingEmail } = await supabase
      .from('users').select('id, email_verified').eq('email', email).single();
    if (existingEmail && existingEmail.email_verified) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    if (existingEmail && !existingEmail.email_verified) {
      await supabase.from('users').delete().eq('email', email);
    }

    const { data: existingPhone } = await supabase
      .from('users').select('id, email_verified').eq('phone_number', phone_number).single();
    if (existingPhone && existingPhone.email_verified) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }
    if (existingPhone && !existingPhone.email_verified) {
      await supabase.from('users').delete().eq('phone_number', phone_number);
    }

    const password_hash = await bcrypt.hash(password, 12);
    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otp_codes').delete().eq('email', email).eq('type', 'signup');

    await supabase.from('otp_codes').insert({
      email, otp, type: 'signup', expires_at,
      used: false
    });

    // Store pending signup data in otp record metadata via a temp approach
    // We'll store hashed password temporarily - use a pending_signups approach
    const { error: insertError } = await supabase.from('users').insert({
      name, email, password_hash, phone_number,
      email_verified: false
    });

    if (insertError) {
      console.error('User insert error:', insertError);
      return res.status(500).json({ error: insertError.message || 'Failed to create account. Run supabase_schema.sql first.' });
    }

    await sendOTPEmail(email, otp, 'signup');
    res.json({ message: 'OTP sent to your email', email, phone: phone_number, phone_number });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
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
      .single();

    if (!otpRecord) return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP expired. Please resend.' });
    }
    if (otpRecord.otp !== otp) {
      return res.status(400).json({ error: 'OTP incorrect' });
    }

    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);
    await supabase.from('users').update({ email_verified: true }).eq('email', email);

    const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
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
    const { email, type = 'signup' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otp_codes').delete().eq('email', email).eq('type', type);
    await supabase.from('otp_codes').insert({ email, otp, type, expires_at, used: false });
    await sendOTPEmail(email, otp, type);

    res.json({ message: 'OTP resent successfully' });
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
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const { data: user } = await supabase.from('users').select('id').eq('email', email).single();
    if (!user) return res.status(404).json({ error: 'No account found with this email' });

    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otp_codes').delete().eq('email', email).eq('type', 'forgot_password');
    await supabase.from('otp_codes').insert({
      email, otp, type: 'forgot_password', expires_at, used: false
    });
    await sendOTPEmail(email, otp, 'forgot_password');

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
      .single();

    if (!otpRecord) return res.status(400).json({ error: 'No OTP found' });
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP expired' });
    }
    if (otpRecord.otp !== otp) {
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
      .single();

    if (!otpRecord) return res.status(400).json({ error: 'Invalid OTP' });
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP expired' });
    }

    const password_hash = await bcrypt.hash(new_password, 12);
    await supabase.from('users').update({ password_hash }).eq('email', email);
    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

module.exports = router;

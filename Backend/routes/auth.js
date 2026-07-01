const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { sendOTP } = require('../config/nodemailer');

const router = express.Router();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, phone: user.phone_number },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, phone_number } = req.body;

    if (!name || !email || !password || !phone_number) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const { data: existingEmail } = await supabase
      .from('users').select('id').eq('email', email).single();
    if (existingEmail) return res.status(400).json({ error: 'Email already registered' });

    const { data: existingPhone } = await supabase
      .from('users').select('id').eq('phone_number', phone_number).single();
    if (existingPhone) return res.status(400).json({ error: 'Phone number already registered' });

    const password_hash = await bcrypt.hash(password, 12);
    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { data: user, error } = await supabase
      .from('users')
      .insert({ name, email, password_hash, phone_number, is_verified: false })
      .select('id, name, email, phone_number')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('otps').insert({ email, otp_code: otp, purpose: 'signup', expires_at });
    await sendOTP(email, otp, 'signup');

    res.json({ message: 'OTP sent to your email', userId: user.id, email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify OTP (signup)
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const { data: otpRecord } = await supabase
      .from('otps')
      .select('*')
      .eq('email', email)
      .eq('otp_code', otp)
      .eq('purpose', 'signup')
      .eq('is_used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!otpRecord) {
      return res.status(400).json({ error: 'OTP incorrect or expired' });
    }

    await supabase.from('otps').update({ is_used: true }).eq('id', otpRecord.id);
    await supabase.from('users').update({ is_verified: true }).eq('email', email);

    const { data: user } = await supabase
      .from('users')
      .select('id, name, email, phone_number, profile_photo')
      .eq('email', email)
      .single();

    const token = signToken(user);
    res.json({ message: 'Email verified successfully', token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resend OTP
router.post('/resend-otp', async (req, res) => {
  try {
    const { email, purpose = 'signup' } = req.body;

    const { data: user } = await supabase.from('users').select('id').eq('email', email).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otps').insert({ email, otp_code: otp, purpose, expires_at });
    await sendOTP(email, otp, purpose);

    res.json({ message: 'OTP resent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user } = await supabase
      .from('users')
      .select('id, name, email, phone_number, password_hash, profile_photo, is_verified')
      .eq('email', email)
      .single();

    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.is_verified) return res.status(401).json({ error: 'Please verify your email first' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    await supabase.from('users').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', user.id);

    const token = signToken(user);
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forgot password - send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    const { data: user } = await supabase.from('users').select('id').eq('email', email).single();
    if (!user) return res.status(404).json({ error: 'Email not found' });

    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otps').insert({ email, otp_code: otp, purpose: 'reset', expires_at });
    await sendOTP(email, otp, 'reset');

    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify reset OTP
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const { data: otpRecord } = await supabase
      .from('otps')
      .select('*')
      .eq('email', email)
      .eq('otp_code', otp)
      .eq('purpose', 'reset')
      .eq('is_used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!otpRecord) {
      return res.status(400).json({ error: 'OTP incorrect or expired' });
    }

    res.json({ message: 'OTP verified', resetToken: otpRecord.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    const { data: otpRecord } = await supabase
      .from('otps')
      .select('*')
      .eq('email', email)
      .eq('otp_code', otp)
      .eq('purpose', 'reset')
      .eq('is_used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!otpRecord) return res.status(400).json({ error: 'OTP incorrect or expired' });

    const password_hash = await bcrypt.hash(newPassword, 12);
    await supabase.from('users').update({ password_hash }).eq('email', email);
    await supabase.from('otps').update({ is_used: true }).eq('id', otpRecord.id);

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

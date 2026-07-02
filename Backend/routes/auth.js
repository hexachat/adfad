const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { sendOTP } = require('../services/email');
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password || !phone) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const { data: existingEmail } = await supabase
      .from('users').select('id').eq('email', email.toLowerCase()).single();
    if (existingEmail) return res.status(400).json({ error: 'Email already registered' });

    const { data: existingPhone } = await supabase
      .from('users').select('id').eq('phone', phone).single();
    if (existingPhone) return res.status(400).json({ error: 'Phone number already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const { data: user, error } = await supabase.from('users').insert({
      name, email: email.toLowerCase(), password_hash: passwordHash, phone, is_verified: false
    }).select('id, name, email, phone').single();

    if (error) return res.status(500).json({ error: error.message });

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await supabase.from('otps').insert({
      email: email.toLowerCase(), otp_code: otp, purpose: 'signup', expires_at: expiresAt
    });
    await sendOTP(email, otp, 'signup');

    res.json({ message: 'OTP sent to email', userId: user.id, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify OTP (signup)
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const { data: otpRecord } = await supabase.from('otps')
      .select('*').eq('email', email.toLowerCase()).eq('otp_code', otp)
      .eq('purpose', 'signup').eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(1).single();

    if (!otpRecord) return res.status(400).json({ error: 'OTP incorrect' });

    await supabase.from('otps').update({ used: true }).eq('id', otpRecord.id);
    await supabase.from('users').update({ is_verified: true }).eq('email', email.toLowerCase());

    const { data: user } = await supabase.from('users')
      .select('id, name, email, phone, avatar_url').eq('email', email.toLowerCase()).single();

    const token = generateToken(user.id);
    await supabase.from('sessions').insert({
      user_id: user.id, token, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });

    res.json({ message: 'Verified successfully', token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resend OTP
router.post('/resend-otp', async (req, res) => {
  try {
    const { email, purpose = 'signup' } = req.body;
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await supabase.from('otps').insert({
      email: email.toLowerCase(), otp_code: otp, purpose, expires_at: expiresAt
    });
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
    const { data: user } = await supabase.from('users')
      .select('*').eq('email', email.toLowerCase()).single();

    if (!user) return res.status(400).json({ error: 'Invalid email or password' });
    if (!user.is_verified) return res.status(400).json({ error: 'Please verify your email first' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid email or password' });

    const token = generateToken(user.id);
    await supabase.from('sessions').insert({
      user_id: user.id, token, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', user.id);

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, avatar_url: user.avatar_url }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forgot password - send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const { data: user } = await supabase.from('users').select('id').eq('email', email.toLowerCase()).single();
    if (!user) return res.status(400).json({ error: 'Email not found' });

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await supabase.from('otps').insert({
      email: email.toLowerCase(), otp_code: otp, purpose: 'reset', expires_at: expiresAt
    });
    await sendOTP(email, otp, 'reset');
    res.json({ message: 'OTP sent to email' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify reset OTP
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const { data: otpRecord } = await supabase.from('otps')
      .select('*').eq('email', email.toLowerCase()).eq('otp_code', otp)
      .eq('purpose', 'reset').eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(1).single();

    if (!otpRecord) return res.status(400).json({ error: 'OTP incorrect' });
    res.json({ message: 'OTP verified', resetToken: otpRecord.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const { data: otpRecord } = await supabase.from('otps')
      .select('*').eq('email', email.toLowerCase()).eq('otp_code', otp)
      .eq('purpose', 'reset').eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(1).single();

    if (!otpRecord) return res.status(400).json({ error: 'OTP incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await supabase.from('users').update({ password_hash: passwordHash }).eq('email', email.toLowerCase());
    await supabase.from('otps').update({ used: true }).eq('id', otpRecord.id);

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get profile
router.get('/profile', authMiddleware, async (req, res) => {
  res.json({ user: req.user });
});

// Update profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, avatar_url } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (avatar_url) updates.avatar_url = avatar_url;

    const { data: user } = await supabase.from('users')
      .update(updates).eq('id', req.user.id)
      .select('id, name, email, phone, avatar_url').single();

    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logout
router.post('/logout', authMiddleware, async (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  await supabase.from('sessions').delete().eq('token', token);
  res.json({ message: 'Logged out' });
});

module.exports = router;

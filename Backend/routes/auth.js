const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { sendOTP } = require('../config/mail');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, phone_number } = req.body;
    if (!name || !email || !password || !phone_number) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const { data: existingEmail } = await supabase
      .from('users').select('id').eq('email', email.toLowerCase()).single();
    if (existingEmail) return res.status(400).json({ error: 'Email already registered' });

    const { data: existingPhone } = await supabase
      .from('users').select('id').eq('phone_number', phone_number).single();
    if (existingPhone) return res.status(400).json({ error: 'Phone number already registered' });

    const password_hash = await bcrypt.hash(password, 12);
    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otp_codes').delete().eq('email', email.toLowerCase()).eq('type', 'signup');

    const { error: otpError } = await supabase.from('otp_codes').insert({
      email: email.toLowerCase(),
      code: otp,
      type: 'signup',
      expires_at
    });

    if (otpError) return res.status(500).json({ error: 'Failed to create OTP' });

    req.app.locals.pendingSignups = req.app.locals.pendingSignups || {};
    req.app.locals.pendingSignups[email.toLowerCase()] = { name, email: email.toLowerCase(), password_hash, phone_number };

    await sendOTP(email, otp, 'signup');
    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/verify-signup', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

    const { data: otpRecord } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('type', 'signup')
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!otpRecord) return res.status(400).json({ error: 'OTP incorrect' });
    if (new Date(otpRecord.expires_at) < new Date()) return res.status(400).json({ error: 'OTP expired' });
    if (otpRecord.code !== otp) return res.status(400).json({ error: 'OTP incorrect' });

    const pending = req.app.locals.pendingSignups?.[email.toLowerCase()];
    if (!pending) return res.status(400).json({ error: 'Signup session expired. Please signup again.' });

    const { data: user, error } = await supabase.from('users').insert({
      name: pending.name,
      email: pending.email,
      password_hash: pending.password_hash,
      phone_number: pending.phone_number,
      is_verified: true
    }).select('id, name, email, phone_number, profile_photo').single();

    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);
    delete req.app.locals.pendingSignups[email.toLowerCase()];

    const token = generateToken(user.id);
    res.json({ success: true, token, user });
  } catch (err) {
    console.error('Verify signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/resend-otp', async (req, res) => {
  try {
    const { email, type } = req.body;
    if (!email || !type) return res.status(400).json({ error: 'Email and type required' });

    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otp_codes').delete().eq('email', email.toLowerCase()).eq('type', type);
    await supabase.from('otp_codes').insert({ email: email.toLowerCase(), code: otp, type, expires_at });
    await sendOTP(email, otp, type);

    res.json({ success: true, message: 'OTP resent' });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data: user } = await supabase
      .from('users')
      .select('id, name, email, phone_number, password_hash, profile_photo, is_verified')
      .eq('email', email.toLowerCase())
      .single();

    if (!user) return res.status(400).json({ error: 'Invalid email or password' });
    if (!user.is_verified) return res.status(400).json({ error: 'Please verify your email first' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid email or password' });

    await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', user.id);

    const token = generateToken(user.id);
    const { password_hash, ...safeUser } = user;
    res.json({ success: true, token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const { data: user } = await supabase.from('users').select('id').eq('email', email.toLowerCase()).single();
    if (!user) return res.status(400).json({ error: 'Email not found' });

    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('otp_codes').delete().eq('email', email.toLowerCase()).eq('type', 'reset');
    await supabase.from('otp_codes').insert({ email: email.toLowerCase(), code: otp, type: 'reset', expires_at });
    await sendOTP(email, otp, 'reset');

    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

    const { data: otpRecord } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('type', 'reset')
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!otpRecord || otpRecord.code !== otp) return res.status(400).json({ error: 'OTP incorrect' });
    if (new Date(otpRecord.expires_at) < new Date()) return res.status(400).json({ error: 'OTP expired' });

    res.json({ success: true, message: 'OTP verified' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ error: 'All fields required' });

    const { data: otpRecord } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('type', 'reset')
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!otpRecord || otpRecord.code !== otp) return res.status(400).json({ error: 'OTP incorrect' });

    const password_hash = await bcrypt.hash(newPassword, 12);
    await supabase.from('users').update({ password_hash }).eq('email', email.toLowerCase());
    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRecord.id);

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { sendOTP } = require('../config/mailer');
const {
  formatUser,
  toDbUser,
  USER_PRIVATE_SELECT,
  USER_AUTH_SELECT
} = require('../config/user-fields');
const {
  setPendingSignup,
  getPendingSignup,
  deletePendingSignup,
  setPasswordReset,
  getPasswordReset,
  deletePasswordReset
} = require('../store/otp-store');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, phone: user.phone || user.phone_number },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, phone_number } = req.body;
    if (!name || !email || !password || !phone_number) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const emailLower = email.toLowerCase().trim();

    const { data: existingEmail } = await supabase
      .from('users')
      .select('id')
      .ilike('email', emailLower)
      .maybeSingle();

    if (existingEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const { data: existingPhone } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone_number.trim())
      .maybeSingle();

    if (existingPhone) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    setPendingSignup(emailLower, {
      name: name.trim(),
      email: emailLower,
      password: hashed,
      phone_number: phone_number.trim(),
      otp,
      otp_expires: expires
    });

    await sendOTP(emailLower, otp, 'signup');
    res.json({ success: true, message: 'OTP sent to your email', email: emailLower });
  } catch (err) {
    console.error('Signup error:', err);
    const msg = err.code === 'EAUTH'
      ? 'Email service error. Check Gmail app password in Backend/.env'
      : 'Signup failed. Please try again.';
    res.status(500).json({ error: msg });
  }
});

router.post('/verify-signup-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP required' });
    }

    const emailLower = email.toLowerCase().trim();
    const pending = getPendingSignup(emailLower);
    if (!pending) {
      return res.status(400).json({ error: 'No pending signup found' });
    }

    if (new Date(pending.otp_expires) < new Date()) {
      return res.status(400).json({ error: 'OTP expired. Please resend.' });
    }

    if (String(pending.otp) !== String(otp).trim()) {
      return res.status(400).json({ error: 'OTP incorrect', incorrect: true });
    }

    const { data: user, error: userErr } = await supabase
      .from('users')
      .insert(
        toDbUser({
          name: pending.name,
          email: pending.email,
          password_hash: pending.password,
          phone_number: pending.phone_number,
          avatar_url: null,
          is_verified: true
        })
      )
      .select(USER_PRIVATE_SELECT)
      .single();

    if (userErr) throw userErr;

    deletePendingSignup(emailLower);

    const formatted = formatUser(user, true);
    const token = signToken(user);
    res.json({ success: true, token, user: formatted });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: err.message || 'Verification failed' });
  }
});

router.post('/resend-signup-otp', async (req, res) => {
  try {
    const emailLower = (req.body.email || '').toLowerCase().trim();
    const pending = getPendingSignup(emailLower);

    if (!pending) {
      return res.status(400).json({ error: 'No pending signup found' });
    }

    const otp = generateOTP();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    setPendingSignup(emailLower, { ...pending, otp, otp_expires: expires });
    await sendOTP(emailLower, otp, 'signup');
    res.json({ success: true, message: 'OTP resent successfully' });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const { password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select(USER_AUTH_SELECT)
      .ilike('email', email)
      .maybeSingle();

    if (error) {
      console.error('Login lookup error:', error);
      return res.status(500).json({ error: 'Login failed' });
    }

    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    res.json({ success: true, token, user: formatUser(user, true) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const emailLower = (req.body.email || '').toLowerCase().trim();
    if (!emailLower) return res.status(400).json({ error: 'Email required' });

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .ilike('email', emailLower)
      .maybeSingle();

    if (!user) {
      return res.status(404).json({ error: 'No account found with this email' });
    }

    const otp = generateOTP();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    setPasswordReset(emailLower, { otp, otp_expires: expires, verified: false });
    await sendOTP(emailLower, otp, 'forgot');
    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

router.post('/verify-forgot-otp', async (req, res) => {
  try {
    const emailLower = (req.body.email || '').toLowerCase().trim();
    const otp = String(req.body.otp || '').trim();
    const reset = getPasswordReset(emailLower);

    if (!reset) return res.status(400).json({ error: 'No reset request found' });
    if (new Date(reset.otp_expires) < new Date()) {
      return res.status(400).json({ error: 'OTP expired' });
    }
    if (String(reset.otp) !== otp) {
      return res.status(400).json({ error: 'OTP incorrect', incorrect: true });
    }

    setPasswordReset(emailLower, { ...reset, verified: true });
    res.json({ success: true, message: 'OTP verified. Enter new password.' });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const emailLower = (req.body.email || '').toLowerCase().trim();
    const otp = String(req.body.otp || '').trim();
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const reset = getPasswordReset(emailLower);
    if (!reset || !reset.verified || String(reset.otp) !== otp) {
      return res.status(400).json({ error: 'Invalid or unverified reset request' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    const { data: updated, error: updateErr } = await supabase
      .from('users')
      .update({ password_hash: hashed })
      .ilike('email', emailLower)
      .select('id, email')
      .maybeSingle();

    if (updateErr) {
      console.error('Reset password DB error:', updateErr);
      return res.status(500).json({ error: 'Failed to update password in database' });
    }

    if (!updated) {
      return res.status(404).json({ error: 'User account not found' });
    }

    deletePasswordReset(emailLower);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.post('/resend-forgot-otp', async (req, res) => {
  try {
    const emailLower = (req.body.email || '').toLowerCase().trim();

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .ilike('email', emailLower)
      .maybeSingle();

    if (!user) return res.status(404).json({ error: 'No account found' });

    const otp = generateOTP();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    setPasswordReset(emailLower, { otp, otp_expires: expires, verified: false });
    await sendOTP(emailLower, otp, 'forgot');
    res.json({ success: true, message: 'OTP resent' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select(USER_PRIVATE_SELECT)
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: formatUser(user, true) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;

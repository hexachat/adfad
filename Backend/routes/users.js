const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const supabase = require('../config/supabase');
const { formatUser, USER_PUBLIC_SELECT } = require('../config/user-fields');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `profile_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

router.post('/profile-photo', authMiddleware, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const photoUrl = `/uploads/${req.file.filename}`;
    await supabase
      .from('users')
      .update({ avatar_url: photoUrl })
      .eq('id', req.user.id);

    res.json({ success: true, profile_photo: photoUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

router.get('/search', authMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ users: [] });

    const { data: byPhone } = await supabase
      .from('users')
      .select(USER_PUBLIC_SELECT)
      .ilike('phone', `%${q}%`)
      .neq('id', req.user.id)
      .limit(20);

    const { data: byName } = await supabase
      .from('users')
      .select(USER_PUBLIC_SELECT)
      .ilike('name', `%${q}%`)
      .neq('id', req.user.id)
      .limit(20);

    const map = new Map();
    [...(byPhone || []), ...(byName || [])].forEach((u) => map.set(u.id, formatUser(u)));
    res.json({ users: Array.from(map.values()) });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/by-phone/:phone', authMiddleware, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select(USER_PUBLIC_SELECT)
      .eq('phone', req.params.phone)
      .neq('id', req.user.id)
      .maybeSingle();

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: formatUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed' });
  }
});

router.get('/:id/public', authMiddleware, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select(USER_PUBLIC_SELECT)
      .eq('id', req.params.id)
      .single();

    res.json({ user: formatUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;

const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = require('express').Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

// Get current user profile
router.get('/me', authMiddleware, async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, name, email, phone_number, profile_photo, is_online, last_seen, created_at')
    .eq('id', req.user.id)
    .single();
  res.json({ user });
});

// Update profile photo
router.post('/photo', authMiddleware, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
  const photoUrl = `/uploads/${req.file.filename}`;
  await supabase.from('users').update({ profile_photo: photoUrl }).eq('id', req.user.id);
  res.json({ message: 'Photo updated', profile_photo: photoUrl });
});

// Update name
router.put('/name', authMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  await supabase.from('users').update({ name }).eq('id', req.user.id);
  res.json({ message: 'Name updated', name });
});

// Search users by name or number
router.get('/search', authMiddleware, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ users: [] });

  const { data: users } = await supabase
    .from('users')
    .select('id, name, phone_number, profile_photo, is_online')
    .or(`name.ilike.%${q}%,phone_number.ilike.%${q}%`)
    .neq('id', req.user.id)
    .limit(20);

  res.json({ users: users || [] });
});

// Get user by phone number
router.get('/by-number/:number', authMiddleware, async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, name, phone_number, profile_photo, is_online, last_seen')
    .eq('phone_number', req.params.number)
    .single();

  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// Get user public profile
router.get('/:id', authMiddleware, async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, name, phone_number, profile_photo, is_online, last_seen')
    .eq('id', req.params.id)
    .single();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;

const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/me', authMiddleware, async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, name, email, phone_number, profile_photo, last_seen, created_at')
    .eq('id', req.userId)
    .single();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

router.put('/profile', authMiddleware, async (req, res) => {
  const { name, profile_photo } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (profile_photo !== undefined) updates.profile_photo = profile_photo;

  const { data: user, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.userId)
    .select('id, name, email, phone_number, profile_photo')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ user });
});

router.get('/search', authMiddleware, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ users: [] });

  const { data: users } = await supabase
    .from('users')
    .select('id, name, phone_number, profile_photo, last_seen')
    .or(`name.ilike.%${q}%,phone_number.ilike.%${q}%`)
    .neq('id', req.userId)
    .limit(20);

  res.json({ users: users || [] });
});

router.get('/by-phone/:phone', authMiddleware, async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, name, phone_number, profile_photo, last_seen')
    .eq('phone_number', req.params.phone)
    .neq('id', req.userId)
    .single();

  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

router.get('/:id', authMiddleware, async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, name, phone_number, profile_photo, last_seen')
    .eq('id', req.params.id)
    .single();

  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;

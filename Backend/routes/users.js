const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/profile', auth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, name, email, phone_number, profile_photo, is_online, last_seen, created_at')
      .eq('id', req.user.id)
      .single();

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/profile', auth, async (req, res) => {
  try {
    const { name, profile_photo } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (profile_photo !== undefined) updates.profile_photo = profile_photo;
    updates.updated_at = new Date().toISOString();

    const { data: user, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.user.id)
      .select('id, name, email, phone_number, profile_photo')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    const { data: users } = await supabase
      .from('users')
      .select('id, name, phone_number, profile_photo, is_online, last_seen')
      .or(`name.ilike.%${q}%,phone_number.ilike.%${q}%`)
      .neq('id', req.user.id)
      .limit(20);

    res.json(users || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/by-phone/:phone', auth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, name, phone_number, profile_photo, is_online, last_seen')
      .eq('phone_number', req.params.phone)
      .neq('id', req.user.id)
      .single();

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, name, phone_number, profile_photo, is_online, last_seen')
      .eq('id', req.params.id)
      .single();

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

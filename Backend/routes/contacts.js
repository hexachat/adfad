const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const { data: contacts } = await supabase
    .from('contacts')
    .select(`
      id, created_at,
      contact:users!contacts_contact_id_fkey(id, name, phone_number, profile_photo, last_seen)
    `)
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false });

  res.json({ contacts: contacts || [] });
});

router.post('/add', authMiddleware, async (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'Phone number required' });

  const { data: contactUser } = await supabase
    .from('users')
    .select('id, name, phone_number, profile_photo')
    .eq('phone_number', phone_number)
    .single();

  if (!contactUser) return res.status(404).json({ error: 'No user found with this number' });
  if (contactUser.id === req.userId) return res.status(400).json({ error: 'Cannot add yourself' });

  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('user_id', req.userId)
    .eq('contact_id', contactUser.id)
    .single();

  if (existing) return res.status(400).json({ error: 'Contact already added' });

  await supabase.from('contacts').insert([
    { user_id: req.userId, contact_id: contactUser.id },
    { user_id: contactUser.id, contact_id: req.userId }
  ]);

  res.json({ success: true, contact: contactUser });
});

router.delete('/:contactId', authMiddleware, async (req, res) => {
  await supabase.from('contacts').delete()
    .eq('user_id', req.userId)
    .eq('contact_id', req.params.contactId);
  res.json({ success: true });
});

module.exports = router;

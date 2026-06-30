const express = require('express');
const supabase = require('../config/supabase');
const { formatUser, USER_PUBLIC_SELECT } = require('../config/user-fields');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, contact_id')
      .eq('user_id', req.user.id);

    const ids = (contacts || []).map((c) => c.contact_id);
    if (!ids.length) return res.json({ contacts: [] });

    const { data: users } = await supabase
      .from('users')
      .select(USER_PUBLIC_SELECT)
      .in('id', ids);

    const userMap = Object.fromEntries((users || []).map((u) => [u.id, formatUser(u)]));

    res.json({
      contacts: (contacts || []).map((c) => ({
        id: c.id,
        contact: userMap[c.contact_id] || null
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

router.post('/add', authMiddleware, async (req, res) => {
  try {
    const phone = (req.body.phone_number || '').trim();
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    const { data: contactUser } = await supabase
      .from('users')
      .select(USER_PUBLIC_SELECT)
      .eq('phone', phone)
      .maybeSingle();

    if (!contactUser) {
      return res.status(404).json({ error: 'No user found with this number' });
    }

    if (contactUser.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot add yourself' });
    }

    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('contact_id', contactUser.id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'Contact already added' });
    }

    const { data: contact, error } = await supabase
      .from('contacts')
      .insert({ user_id: req.user.id, contact_id: contactUser.id })
      .select('id, contact_id')
      .single();

    if (error) throw error;

    const { data: reverseExists } = await supabase
      .from('contacts')
      .select('id')
      .eq('user_id', contactUser.id)
      .eq('contact_id', req.user.id)
      .maybeSingle();

    if (!reverseExists) {
      await supabase.from('contacts').insert({
        user_id: contactUser.id,
        contact_id: req.user.id
      });
    }

    res.json({
      success: true,
      contact: { ...contact, contact: formatUser(contactUser) }
    });
  } catch (err) {
    console.error('Add contact error:', err);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

module.exports = router;

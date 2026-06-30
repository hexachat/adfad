const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = require('express').Router();

// Get all contacts
router.get('/', authMiddleware, async (req, res) => {
  const { data: contacts } = await supabase
    .from('contacts')
    .select(`
      id, created_at,
      contact:contact_user_id (id, name, phone_number, profile_photo, is_online, last_seen)
    `)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  res.json({ contacts: contacts || [] });
});

// Add contact by phone number
router.post('/add', authMiddleware, async (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'Phone number required' });

  const { data: contactUser } = await supabase
    .from('users')
    .select('id, name, phone_number, profile_photo, is_online')
    .eq('phone_number', phone_number)
    .single();

  if (!contactUser) return res.status(404).json({ error: 'No user found with this number' });
  if (contactUser.id === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });

  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('contact_user_id', contactUser.id)
    .single();

  if (existing) return res.status(400).json({ error: 'Contact already added' });

  await supabase.from('contacts').insert({
    user_id: req.user.id,
    contact_user_id: contactUser.id
  });

  // Mutual contact
  const { data: reverseExists } = await supabase
    .from('contacts')
    .select('id')
    .eq('user_id', contactUser.id)
    .eq('contact_user_id', req.user.id)
    .single();

  if (!reverseExists) {
    await supabase.from('contacts').insert({
      user_id: contactUser.id,
      contact_user_id: req.user.id
    });
  }

  res.json({ message: 'Contact added', contact: contactUser });
});

// Delete contact
router.delete('/:id', authMiddleware, async (req, res) => {
  await supabase.from('contacts').delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  res.json({ message: 'Contact removed' });
});

module.exports = router;

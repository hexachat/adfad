const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Search users by name or phone
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ users: [] });

    const { data: users } = await supabase.from('users')
      .select('id, name, phone, avatar_url, last_seen')
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .neq('id', req.user.id)
      .limit(20);

    res.json({ users: users || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add contact by phone number
router.post('/add', authMiddleware, async (req, res) => {
  try {
    const { phone } = req.body;
    const { data: contactUser } = await supabase.from('users')
      .select('id, name, phone, avatar_url, last_seen')
      .eq('phone', phone).single();

    if (!contactUser) return res.status(404).json({ error: 'User not found with this number' });
    if (contactUser.id === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });

    const { data: existing } = await supabase.from('contacts')
      .select('id').eq('user_id', req.user.id).eq('contact_user_id', contactUser.id).single();

    if (existing) return res.status(400).json({ error: 'Contact already added' });

    await supabase.from('contacts').insert({
      user_id: req.user.id, contact_user_id: contactUser.id
    });

    // Also add reverse contact
    const { data: reverseExists } = await supabase.from('contacts')
      .select('id').eq('user_id', contactUser.id).eq('contact_user_id', req.user.id).single();
    if (!reverseExists) {
      await supabase.from('contacts').insert({
        user_id: contactUser.id, contact_user_id: req.user.id
      });
    }

    // Create or get direct conversation
    let conversationId = await getOrCreateDirectConversation(req.user.id, contactUser.id);

    res.json({ contact: contactUser, conversationId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all contacts
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data: contacts } = await supabase.from('contacts')
      .select('contact_user_id, users:contact_user_id(id, name, phone, avatar_url, last_seen)')
      .eq('user_id', req.user.id);

    const contactList = (contacts || []).map(c => c.users);
    res.json({ contacts: contactList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getOrCreateDirectConversation(userId1, userId2) {
  const { data: existing } = await supabase.from('conversation_participants')
    .select('conversation_id, conversations!inner(type)')
    .eq('user_id', userId1);

  for (const ep of existing || []) {
    if (ep.conversations?.type === 'direct') {
      const { data: other } = await supabase.from('conversation_participants')
        .select('user_id').eq('conversation_id', ep.conversation_id).eq('user_id', userId2).single();
      if (other) return ep.conversation_id;
    }
  }

  const { data: conv } = await supabase.from('conversations')
    .insert({ type: 'direct' }).select('id').single();

  await supabase.from('conversation_participants').insert([
    { conversation_id: conv.id, user_id: userId1 },
    { conversation_id: conv.id, user_id: userId2 }
  ]);

  return conv.id;
}

module.exports = router;

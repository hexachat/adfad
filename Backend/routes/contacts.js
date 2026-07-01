const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const { data: contacts } = await supabase
      .from('contacts')
      .select(`
        id, contact_name, created_at,
        contact_user:users!contacts_contact_user_id_fkey(
          id, name, phone_number, profile_photo, is_online, last_seen
        )
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    res.json(contacts || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/add', auth, async (req, res) => {
  try {
    const { phone_number, contact_name } = req.body;

    const { data: targetUser } = await supabase
      .from('users')
      .select('id, name, phone_number, profile_photo')
      .eq('phone_number', phone_number)
      .single();

    if (!targetUser) return res.status(404).json({ error: 'No user found with this number' });
    if (targetUser.id === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });

    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('contact_user_id', targetUser.id)
      .single();

    if (existing) return res.status(400).json({ error: 'Contact already exists' });

    const { data: contact, error } = await supabase
      .from('contacts')
      .insert({
        user_id: req.user.id,
        contact_user_id: targetUser.id,
        contact_name: contact_name || targetUser.name
      })
      .select(`
        id, contact_name,
        contact_user:users!contacts_contact_user_id_fkey(
          id, name, phone_number, profile_photo, is_online, last_seen
        )
      `)
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Create or get direct conversation
    let conversationId = await getOrCreateDirectConversation(req.user.id, targetUser.id);

    res.json({ contact, conversationId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getOrCreateDirectConversation(userId1, userId2) {
  const { data: convs } = await supabase
    .from('conversation_participants')
    .select('conversation_id, conversations!inner(type)')
    .eq('user_id', userId1)
    .eq('conversations.type', 'direct');

  for (const c of convs || []) {
    const { data: other } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', c.conversation_id)
      .eq('user_id', userId2)
      .single();
    if (other) return c.conversation_id;
  }

  const { data: conv } = await supabase
    .from('conversations')
    .insert({ type: 'direct' })
    .select('id')
    .single();

  await supabase.from('conversation_participants').insert([
    { conversation_id: conv.id, user_id: userId1 },
    { conversation_id: conv.id, user_id: userId2 }
  ]);

  return conv.id;
}

module.exports = router;
module.exports.getOrCreateDirectConversation = getOrCreateDirectConversation;

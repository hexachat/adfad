const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/conversations', authMiddleware, async (req, res) => {
  const { data: contacts } = await supabase
    .from('contacts')
    .select(`
      contact:users!contacts_contact_id_fkey(id, name, phone_number, profile_photo, last_seen)
    `)
    .eq('user_id', req.userId);

  const conversations = [];
  for (const c of contacts || []) {
    const contact = c.contact;
    const { data: lastMsg } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${req.userId},receiver_id.eq.${contact.id}),and(sender_id.eq.${contact.id},receiver_id.eq.${req.userId})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('sender_id', contact.id)
      .eq('receiver_id', req.userId)
      .eq('is_read', false);

    conversations.push({ contact, lastMessage: lastMsg, unreadCount: count || 0 });
  }

  conversations.sort((a, b) => {
    const ta = a.lastMessage?.created_at || '1970';
    const tb = b.lastMessage?.created_at || '1970';
    return new Date(tb) - new Date(ta);
  });

  const { data: groupMemberships } = await supabase
    .from('group_members')
    .select(`group:groups(id, name, photo)`)
    .eq('user_id', req.userId);

  for (const gm of groupMemberships || []) {
    const group = gm.group;
    const { data: lastMsg } = await supabase
      .from('messages')
      .select('*')
      .eq('group_id', group.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    conversations.push({ group, lastMessage: lastMsg, unreadCount: 0, isGroup: true });
  }

  res.json({ conversations });
});

router.get('/:chatId', authMiddleware, async (req, res) => {
  const { chatId } = req.params;
  const { isGroup } = req.query;

  let query = supabase.from('messages').select(`
    *, sender:users!messages_sender_id_fkey(id, name, profile_photo, phone_number)
  `).order('created_at', { ascending: true }).limit(100);

  if (isGroup === 'true') {
    query = query.eq('group_id', chatId);
  } else {
    query = query.or(`and(sender_id.eq.${req.userId},receiver_id.eq.${chatId}),and(sender_id.eq.${chatId},receiver_id.eq.${req.userId})`);
  }

  const { data: messages } = await query;

  if (isGroup !== 'true') {
    await supabase.from('messages')
      .update({ is_read: true })
      .eq('sender_id', chatId)
      .eq('receiver_id', req.userId)
      .eq('is_read', false);
  }

  res.json({ messages: messages || [] });
});

router.post('/send', authMiddleware, async (req, res) => {
  const { receiver_id, group_id, content, message_type, attachment_url, attachment_name } = req.body;

  const msg = {
    sender_id: req.userId,
    content,
    message_type: message_type || 'text',
    attachment_url,
    attachment_name
  };

  if (group_id) msg.group_id = group_id;
  else msg.receiver_id = receiver_id;

  const { data: message, error } = await supabase
    .from('messages')
    .insert(msg)
    .select(`*, sender:users!messages_sender_id_fkey(id, name, profile_photo, phone_number)`)
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const io = req.app.get('io');
  if (group_id) {
    io.to(`group:${group_id}`).emit('new_message', message);
  } else {
    io.to(`user:${receiver_id}`).emit('new_message', message);
    io.to(`user:${req.userId}`).emit('new_message', message);
  }

  res.json({ message });
});

module.exports = router;

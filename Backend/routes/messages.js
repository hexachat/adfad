const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Get all conversations for user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data: participations } = await supabase.from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', req.user.id);

    const conversations = [];
    for (const p of participations || []) {
      const { data: conv } = await supabase.from('conversations')
        .select('*').eq('id', p.conversation_id).single();
      if (!conv) continue;

      let chatInfo = {};
      if (conv.type === 'direct') {
        const { data: others } = await supabase.from('conversation_participants')
          .select('user_id, users:user_id(id, name, phone, avatar_url, last_seen)')
          .eq('conversation_id', conv.id).neq('user_id', req.user.id);
        chatInfo = others?.[0]?.users || {};
      } else {
        const { data: group } = await supabase.from('groups')
          .select('id, name, avatar_url').eq('id', conv.group_id).single();
        chatInfo = group || {};
      }

      const { data: lastMsg } = await supabase.from('messages')
        .select('content, message_type, created_at, sender_id')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false }).limit(1).single();

      const { count: unreadCount } = await supabase.from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .neq('sender_id', req.user.id)
        .eq('is_read', false);

      conversations.push({
        id: conv.id,
        type: conv.type,
        userId: chatInfo.id || null,
        name: chatInfo.name,
        phone: chatInfo.phone,
        avatar_url: chatInfo.avatar_url,
        last_seen: chatInfo.last_seen,
        group_id: conv.group_id,
        lastMessage: lastMsg,
        unreadCount: unreadCount || 0
      });
    }

    conversations.sort((a, b) => {
      const ta = a.lastMessage?.created_at || '';
      const tb = b.lastMessage?.created_at || '';
      return tb.localeCompare(ta);
    });

    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages for a conversation
router.get('/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { before } = req.query;

    let query = supabase.from('messages')
      .select('*, sender:users!sender_id(id, name, phone, avatar_url)')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (before) query = query.lt('created_at', before);

    const { data: messages } = await query;

    // Mark as read
    await supabase.from('messages')
      .update({ is_read: true })
      .eq('conversation_id', id)
      .neq('sender_id', req.user.id)
      .eq('is_read', false);

    res.json({ messages: (messages || []).reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send message
router.post('/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, message_type = 'text', media_url, media_duration } = req.body;

    const { data: message, error } = await supabase.from('messages').insert({
      conversation_id: id,
      sender_id: req.user.id,
      content,
      message_type,
      media_url,
      media_duration
    }).select('*, sender:users!sender_id(id, name, phone, avatar_url)').single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

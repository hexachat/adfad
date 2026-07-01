const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/conversations', auth, async (req, res) => {
  try {
    const { data: participations } = await supabase
      .from('conversation_participants')
      .select(`
        conversation_id, last_read_at,
        conversation:conversations(id, type, group_id, updated_at,
          group:groups(id, name, photo))
      `)
      .eq('user_id', req.user.id);

    const conversations = [];

    for (const p of participations || []) {
      const conv = p.conversation;
      if (!conv) continue;

      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content, message_type, created_at, sender_id')
        .eq('conversation_id', conv.id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const { count: unreadCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .gt('created_at', p.last_read_at)
        .neq('sender_id', req.user.id);

      let displayName = '';
      let displayPhoto = null;
      let otherUserId = null;

      if (conv.type === 'group') {
        displayName = conv.group?.name || 'Group';
        displayPhoto = conv.group?.photo;
      } else {
        const { data: others } = await supabase
          .from('conversation_participants')
          .select('user_id, users(id, name, phone_number, profile_photo, is_online, last_seen)')
          .eq('conversation_id', conv.id)
          .neq('user_id', req.user.id);

        if (others?.[0]?.users) {
          displayName = others[0].users.name;
          displayPhoto = others[0].users.profile_photo;
          otherUserId = others[0].users.id;
        }
      }

      conversations.push({
        id: conv.id,
        type: conv.type,
        name: displayName,
        photo: displayPhoto,
        otherUserId,
        groupId: conv.group_id,
        lastMessage: lastMsg,
        unreadCount: unreadCount || 0,
        updatedAt: conv.updated_at
      });
    }

    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:conversationId', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { before, limit = 50 } = req.query;

    let query = supabase
      .from('messages')
      .select(`
        id, content, message_type, media_url, media_duration,
        created_at, sender_id, is_deleted,
        sender:users(id, name, profile_photo)
      `)
      .eq('conversation_id', conversationId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (before) query = query.lt('created_at', before);

    const { data: messages } = await query;

    await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', req.user.id);

    res.json((messages || []).reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/send', auth, async (req, res) => {
  try {
    const { conversation_id, content, message_type = 'text', media_url, media_duration } = req.body;

    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        conversation_id,
        sender_id: req.user.id,
        content,
        message_type,
        media_url,
        media_duration
      })
      .select(`
        id, content, message_type, media_url, media_duration,
        created_at, sender_id,
        sender:users(id, name, profile_photo)
      `)
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversation_id);

    res.json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:messageId', auth, async (req, res) => {
  try {
    await supabase
      .from('messages')
      .update({ is_deleted: true })
      .eq('id', req.params.messageId)
      .eq('sender_id', req.user.id);

    res.json({ message: 'Message deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

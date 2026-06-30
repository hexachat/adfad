const express = require('express');
const supabase = require('../config/supabase');
const { formatUser, USER_PUBLIC_SELECT } = require('../config/user-fields');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

function formatMessage(msg) {
  if (!msg) return msg;
  return {
    ...msg,
    sender: msg.sender ? formatUser(msg.sender) : undefined
  };
}

router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: directMsgs, error: msgErr } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .is('group_id', null)
      .order('created_at', { ascending: false });

    if (msgErr) console.error('Conversations messages error:', msgErr);

    const convMap = new Map();
    for (const msg of directMsgs || []) {
      const otherId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
      if (!otherId || convMap.has(otherId)) continue;
      convMap.set(otherId, msg);
    }

    const otherIds = Array.from(convMap.keys());
    let users = [];
    if (otherIds.length) {
      const { data } = await supabase
        .from('users')
        .select(USER_PUBLIC_SELECT)
        .in('id', otherIds);
      users = data || [];
    }

    const userMap = Object.fromEntries(users.map((u) => [u.id, formatUser(u)]));
    const directConversations = otherIds.map((id) => ({
      type: 'direct',
      user: userMap[id],
      lastMessage: convMap.get(id)
    }));

    const { data: memberships } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId);

    const groupIds = (memberships || []).map((m) => m.group_id);
    let groupConversations = [];

    if (groupIds.length) {
      const { data: groups } = await supabase
        .from('groups')
        .select('id, name')
        .in('id', groupIds);

      for (const group of groups || []) {
        const { data: lastMsg } = await supabase
          .from('messages')
          .select('*')
          .eq('group_id', group.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        groupConversations.push({
          type: 'group',
          group,
          lastMessage: lastMsg
        });
      }
    }

    const { data: contacts, error: contactErr } = await supabase
      .from('contacts')
      .select('contact_id')
      .eq('user_id', userId);

    if (contactErr) console.error('Contacts error:', contactErr);

    let contactUsers = [];
    const contactIds = (contacts || []).map((c) => c.contact_id);
    if (contactIds.length) {
      const { data } = await supabase
        .from('users')
        .select(USER_PUBLIC_SELECT)
        .in('id', contactIds);
      contactUsers = (data || []).map(formatUser);
    }

    res.json({
      conversations: [...directConversations, ...groupConversations],
      contacts: contactUsers
    });
  } catch (err) {
    console.error('Conversations error:', err);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

router.get('/direct/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const otherId = req.params.userId;

    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .or(
        `and(sender_id.eq.${userId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${userId})`
      )
      .is('group_id', null)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Load direct messages error:', error);
      return res.status(500).json({ error: 'Failed to load messages' });
    }

    const senderIds = [...new Set((messages || []).map((m) => m.sender_id))];
    let senderMap = {};
    if (senderIds.length) {
      const { data: senders } = await supabase
        .from('users')
        .select(USER_PUBLIC_SELECT)
        .in('id', senderIds);
      senderMap = Object.fromEntries((senders || []).map((s) => [s.id, s]));
    }

    res.json({
      messages: (messages || []).map((m) =>
        formatMessage({ ...m, sender: senderMap[m.sender_id] })
      )
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

router.get('/group/:groupId', authMiddleware, async (req, res) => {
  try {
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('group_id', req.params.groupId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Load group messages error:', error);
      return res.status(500).json({ error: 'Failed to load group messages' });
    }

    const senderIds = [...new Set((messages || []).map((m) => m.sender_id))];
    let senderMap = {};
    if (senderIds.length) {
      const { data: senders } = await supabase
        .from('users')
        .select(USER_PUBLIC_SELECT)
        .in('id', senderIds);
      senderMap = Object.fromEntries((senders || []).map((s) => [s.id, s]));
    }

    res.json({
      messages: (messages || []).map((m) =>
        formatMessage({ ...m, sender: senderMap[m.sender_id] })
      )
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load group messages' });
  }
});

module.exports = router;

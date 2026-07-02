const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Create group
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { name, memberIds } = req.body;
    if (!name || !memberIds || memberIds.length === 0) {
      return res.status(400).json({ error: 'Group name and members required' });
    }

    const { data: group } = await supabase.from('groups')
      .insert({ name, created_by: req.user.id }).select('*').single();

    const members = [req.user.id, ...memberIds.filter(id => id !== req.user.id)];
    const memberRows = members.map(uid => ({ group_id: group.id, user_id: uid }));
    await supabase.from('group_members').insert(memberRows);

    const { data: conv } = await supabase.from('conversations')
      .insert({ type: 'group', group_id: group.id }).select('id').single();

    const participantRows = members.map(uid => ({ conversation_id: conv.id, user_id: uid }));
    await supabase.from('conversation_participants').insert(participantRows);

    res.json({ group: { ...group, conversation_id: conv.id, members } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user's groups
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data: memberships } = await supabase.from('group_members')
      .select('group_id, groups(id, name, avatar_url, created_by, created_at)')
      .eq('user_id', req.user.id);

    const groups = [];
    for (const m of memberships || []) {
      const { data: conv } = await supabase.from('conversations')
        .select('id').eq('group_id', m.groups.id).single();
      const { data: members } = await supabase.from('group_members')
        .select('user_id, users:user_id(id, name, phone, avatar_url)')
        .eq('group_id', m.groups.id);
      groups.push({
        ...m.groups,
        conversation_id: conv?.id,
        members: (members || []).map(mb => mb.users)
      });
    }
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

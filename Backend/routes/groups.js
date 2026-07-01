const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/create', auth, async (req, res) => {
  try {
    const { name, member_ids } = req.body;

    if (!name || !member_ids || member_ids.length === 0) {
      return res.status(400).json({ error: 'Group name and members required' });
    }

    const { data: group, error } = await supabase
      .from('groups')
      .insert({ name, created_by: req.user.id })
      .select('id, name, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const allMembers = [req.user.id, ...member_ids.filter(id => id !== req.user.id)];
    const memberRows = allMembers.map(uid => ({ group_id: group.id, user_id: uid }));
    await supabase.from('group_members').insert(memberRows);

    const { data: conv } = await supabase
      .from('conversations')
      .insert({ type: 'group', group_id: group.id })
      .select('id')
      .single();

    const participantRows = allMembers.map(uid => ({ conversation_id: conv.id, user_id: uid }));
    await supabase.from('conversation_participants').insert(participantRows);

    res.json({ group, conversationId: conv.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/my-groups', auth, async (req, res) => {
  try {
    const { data: memberships } = await supabase
      .from('group_members')
      .select(`
        group:groups(id, name, photo, created_at,
          members:group_members(count))
      `)
      .eq('user_id', req.user.id);

    res.json(memberships?.map(m => m.group) || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

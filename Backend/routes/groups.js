const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/create', authMiddleware, async (req, res) => {
  const { name, member_ids } = req.body;
  if (!name || !member_ids || !member_ids.length) {
    return res.status(400).json({ error: 'Group name and members required' });
  }

  const { data: group, error } = await supabase
    .from('groups')
    .insert({ name, created_by: req.userId })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const members = [req.userId, ...member_ids].map(uid => ({
    group_id: group.id,
    user_id: uid
  }));

  await supabase.from('group_members').insert(members);
  res.json({ success: true, group });
});

router.get('/', authMiddleware, async (req, res) => {
  const { data: memberships } = await supabase
    .from('group_members')
    .select(`
      group:groups(id, name, photo, created_at, created_by)
    `)
    .eq('user_id', req.userId);

  const groups = (memberships || []).map(m => m.group);
  res.json({ groups });
});

router.get('/:groupId/members', authMiddleware, async (req, res) => {
  const { data: members } = await supabase
    .from('group_members')
    .select(`
      user:users(id, name, phone_number, profile_photo)
    `)
    .eq('group_id', req.params.groupId);

  res.json({ members: (members || []).map(m => m.user) });
});

module.exports = router;

const express = require('express');
const supabase = require('../config/supabase');
const { formatUser, USER_PUBLIC_SELECT } = require('../config/user-fields');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data: memberships } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', req.user.id);

    const groupIds = (memberships || []).map((m) => m.group_id);
    if (!groupIds.length) return res.json({ groups: [] });

    const { data: groups } = await supabase
      .from('groups')
      .select(`
        id, name, created_at, created_by,
        members:group_members(user_id, user:users(${USER_PUBLIC_SELECT}))
      `)
      .in('id', groupIds);

    const formatted = (groups || []).map((g) => ({
      ...g,
      members: (g.members || []).map((m) => ({
        ...m,
        user: formatUser(m.user)
      }))
    }));

    res.json({ groups: formatted });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { name, member_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name required' });

    const { data: group, error: groupErr } = await supabase
      .from('groups')
      .insert({ name, created_by: req.user.id })
      .select()
      .single();

    if (groupErr) throw groupErr;

    const members = [req.user.id, ...(member_ids || [])];
    const uniqueMembers = [...new Set(members)];

    const inserts = uniqueMembers.map((uid) => ({
      group_id: group.id,
      user_id: uid
    }));

    await supabase.from('group_members').insert(inserts);

    res.json({ success: true, group: { ...group, member_ids: uniqueMembers } });
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

module.exports = router;

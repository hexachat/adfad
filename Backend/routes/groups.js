const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = require('express').Router();

// Create group
router.post('/create', authMiddleware, async (req, res) => {
  const { name, member_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'Group name required' });

  const { data: group, error } = await supabase
    .from('groups')
    .insert({ name, created_by: req.user.id })
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: 'Failed to create group' });

  const members = [{ group_id: group.id, user_id: req.user.id, role: 'admin' }];
  for (const uid of (member_ids || [])) {
    if (uid !== req.user.id) {
      members.push({ group_id: group.id, user_id: uid, role: 'member' });
    }
  }
  await supabase.from('group_members').insert(members);

  res.json({ message: 'Group created', group });
});

// Get user's groups
router.get('/', authMiddleware, async (req, res) => {
  const { data: memberships } = await supabase
    .from('group_members')
    .select(`
      role,
      groups (id, name, profile_photo, created_at, created_by)
    `)
    .eq('user_id', req.user.id);

  res.json({ groups: memberships || [] });
});

// Get group members
router.get('/:groupId/members', authMiddleware, async (req, res) => {
  const { data: members } = await supabase
    .from('group_members')
    .select(`
      role,
      user:users (id, name, phone_number, profile_photo, is_online)
    `)
    .eq('group_id', req.params.groupId);

  res.json({ members: members || [] });
});

// Add members to group
router.post('/:groupId/add', authMiddleware, async (req, res) => {
  const { member_ids } = req.body;
  const groupId = req.params.groupId;

  const inserts = (member_ids || []).map(uid => ({
    group_id: groupId, user_id: uid, role: 'member'
  }));
  await supabase.from('group_members').insert(inserts);
  res.json({ message: 'Members added' });
});

module.exports = router;

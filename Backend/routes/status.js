const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const { data: contacts } = await supabase
    .from('contacts')
    .select(`contact:users!contacts_contact_id_fkey(id, name, phone_number, profile_photo)`)
    .eq('user_id', req.userId);

  const contactIds = (contacts || []).map(c => c.contact.id);
  contactIds.push(req.userId);

  const { data: statuses } = await supabase
    .from('statuses')
    .select(`
      *, user:users(id, name, phone_number, profile_photo)
    `)
    .in('user_id', contactIds)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  const grouped = {};
  for (const s of statuses || []) {
    if (!grouped[s.user_id]) grouped[s.user_id] = { user: s.user, statuses: [] };
    grouped[s.user_id].statuses.push(s);
  }

  const { data: myStatuses } = await supabase
    .from('statuses')
    .select('*')
    .eq('user_id', req.userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  res.json({ statusGroups: Object.values(grouped), myStatuses: myStatuses || [] });
});

router.post('/create', authMiddleware, async (req, res) => {
  const { content, media_url, media_type, background_color } = req.body;
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: status, error } = await supabase
    .from('statuses')
    .insert({
      user_id: req.userId,
      content,
      media_url,
      media_type: media_type || 'text',
      background_color: background_color || '#000000',
      expires_at
    })
    .select(`*, user:users(id, name, phone_number, profile_photo)`)
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const io = req.app.get('io');
  io.emit('new_status', status);

  res.json({ status });
});

router.post('/:statusId/view', authMiddleware, async (req, res) => {
  await supabase.from('status_views').upsert({
    status_id: req.params.statusId,
    viewer_id: req.userId
  }, { onConflict: 'status_id,viewer_id' });

  res.json({ success: true });
});

router.get('/:statusId/views', authMiddleware, async (req, res) => {
  const { data: views } = await supabase
    .from('status_views')
    .select(`viewer:users(id, name, profile_photo, phone_number), viewed_at`)
    .eq('status_id', req.params.statusId);

  res.json({ views: (views || []).map(v => ({ ...v.viewer, viewed_at: v.viewed_at })) });
});

router.post('/:statusId/react', authMiddleware, async (req, res) => {
  const { reaction } = req.body;
  await supabase.from('status_reactions').upsert({
    status_id: req.params.statusId,
    user_id: req.userId,
    reaction
  }, { onConflict: 'status_id,user_id' });

  res.json({ success: true });
});

router.delete('/:statusId', authMiddleware, async (req, res) => {
  await supabase.from('statuses').delete()
    .eq('id', req.params.statusId)
    .eq('user_id', req.userId);
  res.json({ success: true });
});

module.exports = router;

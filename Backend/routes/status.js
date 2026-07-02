const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Create status
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { content_type, content, media_url, background_color } = req.body;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data: status } = await supabase.from('statuses').insert({
      user_id: req.user.id,
      content_type,
      content,
      media_url,
      background_color: background_color || '#0066FF',
      expires_at: expiresAt
    }).select('*').single();

    res.json({ status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all active statuses from contacts
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data: contacts } = await supabase.from('contacts')
      .select('contact_user_id').eq('user_id', req.user.id);

    const contactIds = (contacts || []).map(c => c.contact_user_id);
    contactIds.push(req.user.id);

    const { data: statuses } = await supabase.from('statuses')
      .select('*, user:users!user_id(id, name, phone, avatar_url)')
      .in('user_id', contactIds)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    // Group by user
    const grouped = {};
    for (const s of statuses || []) {
      if (!grouped[s.user_id]) {
        grouped[s.user_id] = { user: s.user, statuses: [], viewed: false };
      }
      grouped[s.user_id].statuses.push(s);
    }

    // Check views
    for (const uid of Object.keys(grouped)) {
      const statusIds = grouped[uid].statuses.map(s => s.id);
      const { data: views } = await supabase.from('status_views')
        .select('status_id').eq('viewer_id', req.user.id).in('status_id', statusIds);
      grouped[uid].viewed = (views || []).length === statusIds.length;
    }

    res.json({ statusGroups: Object.values(grouped) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// My statuses (must be before /:id routes)
router.get('/mine/list', authMiddleware, async (req, res) => {
  try {
    const { data: statuses } = await supabase.from('statuses')
      .select('*').eq('user_id', req.user.id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    res.json({ statuses: statuses || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// View status
router.post('/:id/view', authMiddleware, async (req, res) => {
  try {
    await supabase.from('status_views').upsert({
      status_id: req.params.id,
      viewer_id: req.user.id
    }, { onConflict: 'status_id,viewer_id' });
    res.json({ message: 'Viewed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get viewers of a status
router.get('/:id/viewers', authMiddleware, async (req, res) => {
  try {
    const { data: views } = await supabase.from('status_views')
      .select('*, viewer:users!viewer_id(id, name, phone, avatar_url)')
      .eq('status_id', req.params.id);
    res.json({ viewers: (views || []).map(v => ({ ...v.viewer, viewed_at: v.viewed_at })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// React to status
router.post('/:id/react', authMiddleware, async (req, res) => {
  try {
    const { reaction } = req.body;
    await supabase.from('status_reactions').upsert({
      status_id: req.params.id,
      user_id: req.user.id,
      reaction
    }, { onConflict: 'status_id,user_id' });
    res.json({ message: 'Reacted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete status
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await supabase.from('statuses').delete()
      .eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
